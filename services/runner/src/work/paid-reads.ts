/**
 * WHICH POSTS OF A SOURCE THAT BILLS EVERY RE-READ AS A RUN ARE RE-READ, AND WHEN.
 *
 * The short-video source is re-read through a paid scraper run: a start fee and a fee per
 * post returned. TRACK's own grid would read each of its posts every few minutes, one run
 * each, and spend the source's whole line by mid-morning. So its posts are read together, in
 * one run at most every `track.paidRunEveryMinutes`, of at most `track.paidReadMaxPosts`
 * posts, chosen here:
 *
 *   1. young and growing fast — posted inside `rising.fypMaxAgeMs` (the window the growth
 *      paths look at) and gaining at least `track.paidFastMinReachPerMinute` views a minute —
 *      read on every run, fastest first. These are the posts the growth paths need a second
 *      and third reading of; before this, a short video found an hour old was next read three
 *      hours later, when nothing it did could still count.
 *   2. everything else worth a read, once its last reading is `track.paidReadMinMinutes` old,
 *      longest-unread first, in at most `track.paidReadMaxSlowPosts` of the run's places.
 *
 * "Gaining" is the measured rate between its last two readings when there is one, and its
 * average since it was posted when there is only the reading its search came with.
 *
 * ★ "LAST READ" IS THE LAST TIME WE ASKED, NOT THE LAST TIME IT ANSWERED. A deleted or private
 * video is billed and returns nothing, so its newest reading never moves. Clocked by its readings
 * alone it stayed the longest-unread post for good and took a place in every run: on 2026-10-13
 * two such videos were asked about in each of the last five runs (2 of 8 places, about $0.29 a
 * day). `askedAt`, when TRACK last sent it, moves on every ask, answered or not.
 *
 * Its own file, apart from stages.ts, because it is the money rule for that source and has to
 * be testable without a database: the cap here is what keeps re-reads inside their share of the
 * line (see `track.paidReadMaxPosts` for the arithmetic).
 *
 * What breaks if changed carelessly: dropping the cap or the run spacing turns every young
 * video into a run every TRACK pass; ordering the slow re-reads newest-first would starve the
 * oldest posts of any reading at all on a busy day.
 */

import type { Item, Millis, Observation } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';

const MS_PER_MINUTE = 60_000;

export interface PaidCandidate {
  readonly item: Item;
  readonly observations: readonly Observation[];
  /** When a re-read of it was last sent, answered or not; null or absent when never. */
  readonly askedAt?: number | null;
}

/** The newest reach reading we hold for a post: a re-read's, or the one its search came with. */
function latestReach(c: PaidCandidate): { readonly value: number; readonly at: number } | null {
  let best: { value: number; at: number } | null = null;
  for (const o of c.observations) {
    if (o.kind !== 'reach' || o.counter.value === null) continue;
    if (best === null || o.capturedAt > best.at) best = { value: o.counter.value, at: o.capturedAt };
  }
  const own = c.item.counters.reach;
  if (own !== undefined && own !== null && own.value !== null && (best === null || own.observedAt > best.at)) {
    best = { value: own.value, at: own.observedAt };
  }
  return best;
}

/** When the post was last read or asked about: its newest reading, its last ask, or when we first saw it. */
function lastReadAt(c: PaidCandidate): number {
  let newest: number = Math.max(c.item.firstSeenAt, c.askedAt ?? 0);
  for (const o of c.observations) if (o.capturedAt > newest) newest = o.capturedAt;
  const own = c.item.counters.reach;
  if (own !== undefined && own !== null && own.observedAt > newest) newest = own.observedAt;
  return newest;
}

/** Views a minute: measured between readings when we have two, else the average since posting. */
export function growthPerMinute(c: PaidCandidate): number | null {
  let measured: { perMin: number; at: number } | null = null;
  for (const o of c.observations) {
    if (o.kind !== 'reach' || o.rate.kind !== 'measured') continue;
    if (measured === null || o.capturedAt > measured.at) measured = { perMin: o.rate.perMin, at: o.capturedAt };
  }
  if (measured !== null) return measured.perMin;
  const reach = latestReach(c);
  if (reach === null || c.item.postedAt === null) return null;
  const ageMin = (reach.at - c.item.postedAt) / MS_PER_MINUTE;
  return ageMin > 0 ? reach.value / ageMin : null;
}

/** The posts to read in this run, fast growers first, at most `paidReadMaxPosts`. */
export function pickPaidReads(candidates: readonly PaidCandidate[], now: Millis, policy: Policy): readonly Item[] {
  const t = policy.track;
  /* Half a run's spacing: a post read in the last run was read a little after it began. */
  const fastAgain = (t.paidRunEveryMinutes * MS_PER_MINUTE) / 2;
  const fast: { item: Item; perMin: number }[] = [];
  const slow: { item: Item; lastAt: number }[] = [];
  for (const c of candidates) {
    const lastAt = lastReadAt(c);
    const perMin = growthPerMinute(c);
    const young = c.item.postedAt !== null && now - c.item.postedAt <= policy.rising.fypMaxAgeMs;
    if (young && perMin !== null && perMin >= t.paidFastMinReachPerMinute && now - lastAt >= fastAgain) {
      fast.push({ item: c.item, perMin });
    } else if (now - lastAt >= t.paidReadMinMinutes * MS_PER_MINUTE) {
      slow.push({ item: c.item, lastAt });
    }
  }
  fast.sort((a, b) => b.perMin - a.perMin);
  slow.sort((a, b) => a.lastAt - b.lastAt);
  /* Young fast ones first, up to the whole run; the rest only up to `paidReadMaxSlowPosts`, so the
     places beyond it are for young videos that are climbing. */
  const young = fast.map((f) => f.item).slice(0, t.paidReadMaxPosts);
  const rest = slow.map((s) => s.item).slice(0, Math.max(0, Math.min(t.paidReadMaxSlowPosts, t.paidReadMaxPosts - young.length)));
  return [...young, ...rest];
}
