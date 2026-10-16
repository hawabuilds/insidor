/**
 * A NARRATIVE'S TOTAL VIEWS OVER TIME, AS DECISIONS: the sum of its posts' views at each moment we
 * can say it, the moments we cannot, and the views it gained in the last hour. Pure, apart from the
 * chart (StoryChart.tsx) and the page, so `node --test` holds the rule.
 *
 * ★ THE RULE (the owner's, 2026-10-16). The total at a time t is the sum, over every post the page
 * lists, of that post's views at t, and it exists only when EVERY post's views at t are known:
 *
 *   - A post's views at t are its last counted reading at or before t, carried forward ONLY within
 *     its normal reading gap: CARRY_SLACK times its own usual (median) spacing between readings, or
 *     the posts' pooled usual spacing when it has too few readings of its own to have one.
 *   - Before a post went up its views are a known 0. That is the only zero this file ever adds.
 *   - Anything else is unknown: a post with no reading yet after it went up, a post whose last
 *     reading is older than its gap (we stopped reading it, or an outage), a post whose posting time
 *     is not known and that has no reading yet, a reading the source rounded away (null).
 *   - Where any post is unknown the total is NOT drawn: that moment is a break, the line stops and
 *     no Gained bar may span it. A missing post is never summed as zero and never guessed.
 *
 * The moments considered are the times of the posts' own readings (and their posting times); a total
 * is never put at a time nobody read.
 *
 * GAINED IN THE LAST HOUR: the newest total against the total nearest an hour before it (45 to 75
 * minutes back), with no break between them, and only when the newest total is fresh. Said with its
 * real span. Otherwise a reason, never a zero.
 *
 * What breaks if changed carelessly: carrying a reading forward without the gap limit makes a post
 * we stopped reading hours ago look flat, and the narrative's line look like it stopped growing.
 */

import type { Reading } from '../post-sheet/sheet-view.ts';

const MINUTE = 60_000;

/** How many of a post's usual spacings its last reading may be carried forward. */
export const CARRY_SLACK = 1.5;
/** "The last hour": the earlier total is looked for this far back, give or take the slack. */
export const HOUR_BACK_MS = 60 * MINUTE;
export const HOUR_SLACK_MS = 15 * MINUTE;
/** The newest total must be at most this old for "gained in the last hour" to be said. */
export const GAINED_FRESH_MS = 15 * MINUTE;

export interface MemberViews {
  readonly id: string;
  /** When the post went up; null when nobody knows. */
  readonly postedAt: number | null;
  readonly readings: readonly Reading[];
}

export interface StoryTotal {
  /** The totals we can say, oldest first. */
  readonly points: readonly { readonly atMs: number; readonly value: number }[];
  /** The moments the total could not be said: the chart breaks there. */
  readonly breaks: readonly number[];
  /** How many posts' views are unknown now (at `now`): 0 when the newest total is complete. */
  readonly unknownNow: number;
  /** How many posts have no reading at all. */
  readonly neverRead: number;
}

function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] ?? null) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

const countedOf = (rs: readonly Reading[]) =>
  rs.filter((r): r is { atMs: number; value: number } => r.value !== null).sort((a, b) => a.atMs - b.atMs);

const spacings = (rs: readonly { atMs: number }[]) => rs.slice(1).map((r, i) => r.atMs - (rs[i]?.atMs ?? r.atMs));

/** One post, ready to be asked "what were your views at t?". */
interface Member {
  readonly postedAt: number | null;
  /** Its counted readings, oldest first; a rounded-away reading is not a value and is not here. */
  readonly counted: readonly { readonly atMs: number; readonly value: number }[];
  /** How far its last reading may be carried forward. */
  readonly carryMs: number;
}

/** The post's views at t, or null when unknown (see the header). */
function viewsAt(m: Member, t: number): number | null {
  if (m.postedAt !== null && t < m.postedAt) return 0;
  let last: { atMs: number; value: number } | undefined;
  for (const r of m.counted) {
    if (r.atMs > t) break;
    last = r;
  }
  if (last === undefined) return null;
  return t - last.atMs <= m.carryMs ? last.value : null;
}

export function storyTotal(members: readonly MemberViews[], now: number): StoryTotal {
  const counted = members.map((m) => countedOf(m.readings));
  const pooled = median(counted.flatMap(spacings)) ?? 0;
  const prepared: Member[] = members.map((m, i) => {
    const own = median(spacings(counted[i] ?? []));
    return { postedAt: m.postedAt, counted: counted[i] ?? [], carryMs: CARRY_SLACK * (own ?? pooled) };
  });

  const times = [...new Set([
    ...counted.flatMap((c) => c.map((r) => r.atMs)),
    ...members.flatMap((m) => (m.postedAt === null ? [] : [m.postedAt])),
  ])].filter((t) => t <= now).sort((a, b) => a - b);

  const points: { atMs: number; value: number }[] = [];
  const breaks: number[] = [];
  for (const t of times) {
    let sum = 0;
    let known = true;
    for (const m of prepared) {
      const v = viewsAt(m, t);
      if (v === null) {
        known = false;
        break;
      }
      sum += v;
    }
    if (!known) breaks.push(t);
    /* A moment before any post went up is not part of the narrative's span. */
    else if (prepared.some((m) => m.postedAt === null || m.postedAt <= t)) points.push({ atMs: t, value: sum });
  }

  return {
    points,
    breaks,
    unknownNow: prepared.filter((m) => viewsAt(m, now) === null).length,
    neverRead: counted.filter((c) => c.length === 0).length,
  };
}

export type HourGain =
  | { readonly kind: 'value'; readonly gain: number; readonly minutes: number }
  | { readonly kind: 'unknown'; readonly why: string };

/** Views gained in about the last hour, from two totals with no break between them (see the header). */
export function gainedLastHour(total: StoryTotal, now: number): HourGain {
  const newest = total.points[total.points.length - 1];
  if (newest === undefined) return { kind: 'unknown', why: total.neverRead > 0 ? 'Some posts have no view readings' : 'No view readings yet' };
  if (now - newest.atMs > GAINED_FRESH_MS) return { kind: 'unknown', why: 'Not every post has a recent view reading' };
  let best: { atMs: number; value: number } | null = null;
  for (const p of total.points) {
    const back = newest.atMs - p.atMs;
    if (back < HOUR_BACK_MS - HOUR_SLACK_MS || back > HOUR_BACK_MS + HOUR_SLACK_MS) continue;
    if (best === null || Math.abs(back - HOUR_BACK_MS) < Math.abs(newest.atMs - best.atMs - HOUR_BACK_MS)) best = p;
  }
  if (best === null) return { kind: 'unknown', why: 'No reading of every post an hour ago' };
  const from = best.atMs;
  if (total.breaks.some((b) => b > from && b < newest.atMs)) return { kind: 'unknown', why: 'Not every post was read through the last hour' };
  return { kind: 'value', gain: newest.value - best.value, minutes: Math.round((newest.atMs - from) / MINUTE) };
}
