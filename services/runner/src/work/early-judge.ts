/**
 * EARLY JUDGING: the likeliest catch-all posts judged before their views clear For You's bar.
 *
 * score-posts.ts sends a catch-all post to the judge only once its reach clears the bar, so a post
 * that clears it waits one more judging pass before it can show, and a post coined in the minutes
 * before it clears is shown after its coin or not at all. This pass judges, ahead of the bar, the
 * few posts most like the ones that get coined (Policy.judge.early: the lanes they come from, young,
 * and fast for their age), so that when one clears the bar it is already answered and the next
 * frame shows it. The answer is filed exactly as score-posts files one — the same queue judging
 * (`judgeQueue`), reuse, owner's labels, junk filter and kind question — and the reach bar still
 * decides whether the post is shown: an early "yes" under the bar is on no feed.
 *
 * ★ ITS OWN LOOP, NEVER THE DISCOVERY PASS. The feed stalled twice on 2026-10-16 from slow work
 * inside the discovery pass, whose last step judges the posts that cleared the bar. This pass
 * runs in loops/early.ts on its own cadence; a slow judge here delays only the next early pass.
 *
 * ★ BOUNDED THREE WAYS: `maxPerPass` posts a pass (fastest first), `everyMs` between passes, and
 * `dailyUsd` a UTC day of its judge and embedding spend, kept in internal.lane_spend (lane
 * `judge_early`, 0088) so a restart does not refill it. An unreadable ledger asks nothing (fail
 * closed, as the capped lanes do). The cap can be passed by at most one pass's spend.
 *
 * ★ THE QUOTE BOOST RIDES THE SAME LOOP (Policy.judge.reproductionBoost, its own cap and lane 'quoted').
 * A stored post a big account has just quoted or reposted the media of is judged first, whatever
 * its views, and credited to 'quoted' so TRACK re-reads it. It runs whether or not early judging is
 * on, and never skips through the junk filter: the reproduction is the evidence.
 *
 * ★ NOT THE NORMAL PATH'S POSTS. A post already over the bar is left to score-posts, so the two
 * do not race for the same post; a post that crosses the bar between the two reads can be judged
 * twice, and the newer answer stands, as after any re-score.
 *
 * What breaks if changed carelessly: the owner's labels are not refreshed here (`refresh` is the
 * discovery pass's, and two at once would embed the same new labels twice), and the shadow is not
 * offered these batches (its cap is the live line's). An early answer stops TRACK re-reading a
 * post the answer rules out (track-gate.ts) — the saving is real only while the answer is filed
 * under the live prompt, which `judgeQueue` guarantees.
 */

import type { Item, Millis } from '@insidor/contracts';
import { clearsReachBar } from '@insidor/core';
import type { PgItemRepo } from '@insidor/store';

import { errorText } from '../log.ts';
import type { CappedLane, LaneLedger } from './lane-ledger.ts';
import { judgeQueue, junkFitFor, kindLabelOf, type ScoringDeps, type ScoringResult } from './score-posts.ts';

/** The source held to the short-video bars (Policy.rising.shortVideoReachScale), as score-posts.ts names it. */
const SHORT_VIDEO_SOURCE = 'tiktok';

/** Its row in the capped lanes' ledger (0088). */
export const EARLY_LANE: CappedLane = 'judge_early';

/** How many never-judged posts are read per lane for each one a pass may judge. */
const PREFETCH_FACTOR = 30;

const MS_PER_MINUTE = 60_000;

export interface EarlyDeps extends Omit<ScoringDeps, 'items' | 'shadow'> {
  /** `reproducedOriginals` and `markFoundBy` are the quote boost's; without them it reads nothing. */
  readonly items: Pick<PgItemRepo, 'catchAllUnscored' | 'reachReadings'> & Partial<Pick<PgItemRepo, 'reproducedOriginals' | 'markFoundBy'>>;
  /** The account watch's list as last read (handles), for the quote boost's "big". Absent: followers only. */
  readonly watchHandles?: () => readonly string[];
  readonly ledger: Pick<LaneLedger, 'spent' | 'add'>;
  /**
   * What the embeddings this pass's precedents asked for have cost so far, as a running total in
   * dollars. Read before and after the pass; the difference is charged to the lane with the judge's
   * spend. Absent: only the judge's spend is charged.
   */
  readonly embedSpentUsd?: () => number;
}

export interface EarlyResult extends ScoringResult {
  /** Never-judged posts read from the lanes this pass. */
  readonly looked: number;
  /** Of those, the ones the rule picked (before `maxPerPass`). */
  readonly eligible: number;
  /** Why nothing was asked, when nothing was. */
  readonly held?: 'off' | 'no-judge' | 'ledger' | 'cap';
  /** Originals the quote boost sent to the judge this pass (inside `queued`). */
  readonly boosted?: number;
}

const none = (held: EarlyResult['held'], looked = 0, eligible = 0): EarlyResult => ({ queued: 0, scored: 0, copied: 0, waiting: 0, wouldSpendUsd: 0, spentUsd: 0, looked, eligible, ...(held === undefined ? {} : { held }) });

/**
 * The post's fastest average since it was posted, in views a minute, over readings of at least
 * `minReach` (scaled), inside `maxAgeMs` of its post time; null when none qualifies.
 */
export function earlySpeed(readings: readonly { atMs: number; reach: number | null }[], postedAtMs: number, minReach: number, maxAgeMs: number): number | null {
  let best: number | null = null;
  for (const x of readings) {
    if (x.reach === null || x.reach < minReach) continue;
    const ageMs = x.atMs - postedAtMs;
    if (ageMs <= 0 || ageMs > maxAgeMs) continue;
    const perMinute = x.reach / (ageMs / MS_PER_MINUTE);
    if (best === null || perMinute > best) best = perMinute;
  }
  return best;
}

/** Its row in the capped lanes' ledger, and the lane its originals are credited to (0116). */
export const BOOST_LANE: CappedLane = 'quoted';

/**
 * THE QUOTE BOOST (Policy.judge.reproductionBoost): the never-judged originals a big account has just
 * quoted or reposted the media of, judged now whatever their views, credited to 'quoted' so TRACK
 * re-reads them. Its own cap; the junk filter is not applied. Returns what it asked.
 */
async function boostPass(deps: EarlyDeps, saidCap: { day: string | null }): Promise<ScoringResult & { readonly boosted: number }> {
  const b = deps.policy.judge.reproductionBoost;
  const nothing = { queued: 0, scored: 0, copied: 0, waiting: 0, wouldSpendUsd: 0, spentUsd: 0, boosted: 0 };
  const find = deps.items.reproducedOriginals?.bind(deps.items);
  if (!b.on || deps.judge === null || find === undefined) return nothing;
  const now = deps.now();
  const spent = await deps.ledger.spent(BOOST_LANE, now);
  if (spent === null) {
    deps.log.warn('quote boost: what it spent today cannot be read; it asks nothing until it can', { lane: BOOST_LANE });
    return nothing;
  }
  if (spent >= b.dailyUsd) {
    const day = new Date(now).toISOString().slice(0, 10);
    if (saidCap.day !== day) {
      saidCap.day = day;
      deps.log.info('quote boost: the day\'s cap is spent; reproduced posts wait for the reach bar', { spentUsd: Number(spent.toFixed(4)), capUsd: b.dailyUsd });
    }
    return nothing;
  }
  const found = await find({
    reproducedSince: (now - b.windowMs) as Millis,
    postedSince: (now - b.maxOriginalAgeMs) as Millis,
    minFollowers: b.minFollowers,
    handles: deps.watchHandles?.() ?? [],
    limit: b.maxPerPass,
  });
  if (found.length === 0) return nothing;
  const queue = found.map((f) => f.item);
  /* Credited before judging, so a post judged here is re-read even if the judge fails it this pass. */
  if (deps.mode === 'live' && deps.items.markFoundBy !== undefined) {
    try {
      await deps.items.markFoundBy(queue.map((i) => i.itemId), BOOST_LANE, now);
    } catch (e) {
      deps.log.error('quote boost could not credit its originals; they are judged but not re-read', { err: errorText(e) });
    }
  }
  const embedBefore = deps.embedSpentUsd?.() ?? 0;
  const precedents = deps.precedents === undefined || deps.precedents === null ? null : { refresh: async () => ({ embedded: 0, relabelled: 0 }), forPosts: deps.precedents.forPosts };
  const result = await judgeQueue({ ...deps, precedents, shadow: null }, queue, { rescoring: [], junkFit: null, kindLabel: kindLabelOf(deps.kindJudge), now });
  const usd = result.spentUsd + Math.max(0, (deps.embedSpentUsd?.() ?? 0) - embedBefore);
  if (deps.mode === 'live' && usd > 0) {
    try {
      await deps.ledger.add(BOOST_LANE, deps.now(), usd);
    } catch (e) {
      deps.log.error('quote boost could not record what it spent', { usd, err: errorText(e) });
    }
  }
  deps.log.info('quote boost', { asked: queue.length, scored: result.scored, by: found.map((f) => `${String(f.item.itemId)}<${f.by}`), usd: Number(usd.toFixed(6)) });
  return { ...result, boosted: queue.length };
}

/**
 * One early pass: the quote boost's originals first, then the early picks. Says once per day when a
 * cap holds it, and every time a ledger cannot be read.
 */
export function earlyJudge(deps: EarlyDeps): () => Promise<EarlyResult> {
  const boostCap = { day: null as string | null };
  const early = earlyPicks(deps);
  return async () => {
    const boosted = await boostPass(deps, boostCap);
    const r = await early();
    if (boosted.boosted === 0) return r;
    return {
      ...r,
      queued: r.queued + boosted.queued,
      scored: r.scored + boosted.scored,
      copied: r.copied + boosted.copied,
      waiting: r.waiting + boosted.waiting,
      wouldSpendUsd: r.wouldSpendUsd + boosted.wouldSpendUsd,
      spentUsd: r.spentUsd + boosted.spentUsd,
      boosted: boosted.boosted,
    };
  };
}

function earlyPicks(deps: EarlyDeps): () => Promise<EarlyResult> {
  let capSaidFor: string | null = null;
  return async () => {
    const e = deps.policy.judge.early;
    if (!e.on) return none('off');
    if (deps.judge === null) return none('no-judge');
    const now = deps.now();
    const spent = await deps.ledger.spent(EARLY_LANE, now);
    if (spent === null) {
      deps.log.warn('early judging: what it spent today cannot be read; it asks nothing until it can', { lane: EARLY_LANE });
      return none('ledger');
    }
    if (spent >= e.dailyUsd) {
      const day = new Date(now).toISOString().slice(0, 10);
      if (capSaidFor !== day) {
        capSaidFor = day;
        deps.log.info('early judging: the day\'s cap is spent; posts wait for the reach bar as before', { spentUsd: Number(spent.toFixed(4)), capUsd: e.dailyUsd });
      }
      return none('cap');
    }

    const junkFit = await junkFitFor(deps);
    const since = (now - e.maxAgeMs) as Millis;
    const lanes = await Promise.all(e.lanes.map((lane) => deps.items.catchAllUnscored(since, e.maxPerPass * PREFETCH_FACTOR, e.minReach, lane, junkFit !== null)));
    const seen = new Set<string>();
    const looked: Item[] = [];
    for (const i of lanes.flat()) {
      if (seen.has(String(i.itemId))) continue;
      seen.add(String(i.itemId));
      looked.push(i);
    }
    if (looked.length === 0) return none(undefined);
    const readings = await deps.items.reachReadings(looked.map((i) => i.itemId), since);
    const picked: { item: Item; speed: number }[] = [];
    for (const item of looked) {
      if (item.postedAt === null || now - item.postedAt > e.maxAgeMs) continue;
      if ((item.counters.approval?.value ?? 0) < e.minApprovals) continue;
      const scale = String(item.source) === SHORT_VIDEO_SOURCE ? deps.policy.rising.shortVideoReachScale : 1;
      const read = readings.get(String(item.itemId)) ?? [];
      /* Over the bar: score-posts' post, not this pass's. */
      if (clearsReachBar('fyp', read, item.postedAt, deps.policy, scale)) continue;
      const speed = earlySpeed(read, item.postedAt, e.minReach * scale, e.maxAgeMs);
      if (speed === null || speed < e.minReachPerMinute * scale) continue;
      picked.push({ item, speed: speed / scale });
    }
    picked.sort((a, b) => b.speed - a.speed);
    const queue = picked.slice(0, e.maxPerPass).map((p) => p.item);
    if (queue.length === 0) return none(undefined, looked.length, picked.length);

    const embedBefore = deps.embedSpentUsd?.() ?? 0;
    const precedents = deps.precedents === undefined || deps.precedents === null ? null : { refresh: async () => ({ embedded: 0, relabelled: 0 }), forPosts: deps.precedents.forPosts };
    const result = await judgeQueue({ ...deps, precedents, shadow: null }, queue, { rescoring: [], junkFit, kindLabel: kindLabelOf(deps.kindJudge), now });
    const usd = result.spentUsd + Math.max(0, (deps.embedSpentUsd?.() ?? 0) - embedBefore);
    if (deps.mode === 'live' && usd > 0) {
      try {
        await deps.ledger.add(EARLY_LANE, deps.now(), usd);
      } catch (e2) {
        deps.log.error('early judging could not record what it spent', { usd, err: errorText(e2) });
      }
    }
    deps.log.info('early judging', { looked: looked.length, eligible: picked.length, asked: queue.length, scored: result.scored, copied: result.copied, usd: Number(usd.toFixed(6)), spentTodayUsd: Number((spent + usd).toFixed(4)) });
    return { ...result, looked: looked.length, eligible: picked.length };
  };
}
