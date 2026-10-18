/**
 * FOR YOU'S TRENDING AND MOST VIEWED, AS ARITHMETIC: one post's views gained in a window from its own
 * readings, its place on each list, and the order of a list (the owner, 2026-10-17 and 18).
 *
 * ★ WHY IT LIVES IN CORE. Two processes must agree on it exactly: the read service orders the lists
 * people see (services/read post-sorts.ts), and the runner's readings loop keeps the text source's
 * posts that would be in a list's top fresh (services/runner work/sort-top.ts). If each had its own
 * copy, the runner would keep the wrong posts fresh the first time one copy changed. So the rule is
 * here, its thresholds in Policy.rising.forYouSorts, and both callers pass the readings in.
 *
 * THE GAIN RULE is the narratives' (group/narrative.ts `narrativeReach`): between two readings the gain
 * is spread evenly over the time between them, a lower count than the one before adds nothing, and
 * before the first reading or after the last it adds nothing, never a guess forward.
 *
 * ★ THE KEYS. W the window, H = W / 2, now the moment asked about.
 *   gain(a, b)  views gained in [a, b); read(a, b) how much of [a, b) lies between the first and last
 *               reading; rate(a, b) = gain / read in views a minute, known only with a reading of its
 *               own inside [a, b) and read(a, b) >= W / minReadShare.
 *   Most viewed key = gain(now - W, now). On the list only with a reading inside the window.
 *   Trending    speed = rate(now - H, now), before = rate(now - W, now - H), both divided by the
 *               caller's `scale` (the short-video source's reach scale), both known or no trend.
 *               Over the window's floor (speed >= its trendFloorsPerMin): key = speed / before, how many times
 *               faster it gains now than just before; a post that gained nothing before and is over
 *               the floor now is faster than any ratio. Under the floor: ordered by speed alone,
 *               below every post over it, so a post going from 3 to 30 views a minute cannot top a
 *               list on its tenfold. No trend (one reading, or one long gap across both halves that
 *               would make the two rates equal by construction): below those, by views gained.
 *   Trending now (the owner's third design, 2026-10-18; `riserPlace`, `trendingList`, Policy.rising
 *               .forYouSorts.risers): speed now = rate over the last 30 minutes, before = rate over the
 *               hour before (30 to 90 minutes ago), each needing readings that measure its span (see
 *               the policy). A riser: now >= the floor, now >= minRatio x before, fresh; key = now /
 *               before (a post that gained nothing before is faster than any ratio). Under `fillBelow`
 *               risers, the 1h rule's picks over its floor fill the list to `fillTo`.
 *   Most viewed over a span (the app's Today and This week, the owner 2026-10-18; `viewedPlace`):
 *               on the list when it was POSTED inside the span (first seen, when the posted time is
 *               unknown), key = its total views at its newest reading, the number the card shows.
 *               No reading, no total: left off, never listed at zero.
 *   Freshness   a post whose newest reading is freshMs old or more is listed after every post read
 *               since, whatever its key.
 *   Ties        the speed (Trending), then the newer post, then the id in byte order.
 *
 * What breaks if changed carelessly: letting a half's rate stand without a reading of its own gives
 * a post read hourly a ratio of exactly 1 instead of no trend; dropping the floor puts the smallest
 * posts at the top of Trending on noise; and counting past the last reading invents views.
 */

import type { Policy } from '@insidor/contracts';

import { MS_PER_MINUTE } from '../math.ts';

export type PostSortBy = 'trending' | 'most_viewed';

/** One reading of a post's views; a null value is a reading whose count we may not use. */
export interface SortReading {
  readonly atMs: number;
  readonly value: number | null;
}

/** [from, to, views gained between them]. */
export type GainRun = readonly [number, number, number];

/** A post's gains as runs between consecutive counted readings, and when each counted reading was taken. */
export function runsOf(readings: readonly SortReading[]): { readonly runs: readonly GainRun[]; readonly first: number | null; readonly last: number | null; readonly times: readonly number[] } {
  const pts = readings.filter((r): r is { atMs: number; value: number } => r.value !== null && Number.isFinite(r.value)).sort((a, b) => a.atMs - b.atMs);
  const runs: GainRun[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a === undefined || b === undefined || b.atMs <= a.atMs) continue;
    runs.push([a.atMs, b.atMs, Math.max(0, b.value - a.value)]);
  }
  return { runs, first: pts[0]?.atMs ?? null, last: pts[pts.length - 1]?.atMs ?? null, times: pts.map((p) => p.atMs) };
}

/** Views gained in [from, to): each run's gain spread evenly over its own time. */
export function gainIn(runs: readonly GainRun[], from: number, to: number): number {
  let sum = 0;
  for (const run of runs) {
    const overlap = Math.min(run[1], to) - Math.max(run[0], from);
    if (overlap > 0) sum += (run[2] * overlap) / (run[1] - run[0]);
  }
  return sum;
}

function readIn(first: number | null, last: number | null, from: number, to: number): number {
  return first === null || last === null ? 0 : Math.max(0, Math.min(last, to) - Math.max(first, from));
}

/** Where a post stands among the groups of a list. Never on the wire. */
export type SortGroup = 'over_floor' | 'under_floor' | 'no_trend';

export interface SortPlace {
  readonly id: string;
  /** Views gained in the window (windowed lists); its total on Most viewed over a span. */
  readonly gained: number;
  /** Whether `postedMs` is the post's posted time (false: when we first saw it). */
  readonly postedKnown: boolean;
  /** The ordering key inside its group. Never on the wire. */
  readonly key: number;
  readonly group: SortGroup;
  readonly fresh: boolean;
  /** Views a minute in the window's later half, scaled; null when not known (Most viewed, or no trend). */
  readonly speed: number | null;
  /** Views a minute in the earlier half, scaled; null when not known. */
  readonly before: number | null;
  readonly postedMs: number | null;
  /** When its newest counted reading was taken. */
  readonly lastReadMs: number;
}

/**
 * One post's place on a list, or null when it is not on it. `scale` divides its gains for the
 * Trending speeds alone; `gained` stays its real views.
 */
export function sortPlace(id: string, readings: readonly SortReading[], postedMs: number | null, by: PostSortBy, windowMs: number, nowMs: number, policy: Policy, scale: number = 1): SortPlace | null {
  const p = policy.rising.forYouSorts;
  const { runs, first, last, times } = runsOf(readings);
  const from = nowMs - windowMs;
  if (last === null || readIn(first, last, from, nowMs) <= 0) return null;
  const gained = gainIn(runs, from, nowMs);
  const base = { id, gained, postedMs, postedKnown: postedMs !== null, lastReadMs: last, fresh: nowMs - last < p.freshMs };
  if (by === 'most_viewed') return { ...base, key: gained, group: 'over_floor', speed: null, before: null };
  const half = from + windowMs / 2;
  const minRead = windowMs / p.minReadShare;
  const rate = (a: number, b: number, inside: (t: number) => boolean): number | null => {
    const r = readIn(first, last, a, b);
    return r < minRead || !times.some(inside) ? null : gainIn(runs, a, b) / scale / (r / MS_PER_MINUTE);
  };
  const speed = rate(half, nowMs, (t) => t >= half && t <= nowMs);
  const before = rate(from, half, (t) => t >= from && t < half);
  if (speed === null || before === null) return { ...base, key: gained / scale, group: 'no_trend', speed: null, before: null };
  if (speed < trendFloor(windowMs, policy)) return { ...base, key: speed, group: 'under_floor', speed, before };
  return { ...base, key: before > 0 ? speed / before : Infinity, group: 'over_floor', speed, before };
}

/**
 * A post's two speeds for Trending now, scaled, when its readings measure both spans; null when they
 * do not (see Policy.rising.forYouSorts.risers). Each speed is over the part of its span that lies
 * between readings, and speed now never runs past the last reading.
 */
export function riserSpeeds(readings: readonly SortReading[], nowMs: number, policy: Policy, scale: number = 1): { readonly now: number; readonly before: number; readonly last: number } | null {
  const r = policy.rising.forYouSorts.risers;
  const { runs, first, last, times } = runsOf(readings);
  if (first === null || last === null) return null;
  const mark = nowMs - r.nowSpanMs;
  const start = mark - r.beforeSpanMs;
  if (!times.some((t) => t > mark && t <= nowMs) || !times.some((t) => t >= start && t < mark)) return null;
  const across = runs.find((x) => x[0] < mark && x[1] > mark);
  if (across !== undefined && across[1] - across[0] > r.maxMarkGapMs) return null;
  const nowRead = Math.min(last, nowMs) - mark;
  const beforeRead = mark - Math.max(first, start);
  if (nowRead < r.nowSpanMs * r.minCoverShare || beforeRead < r.beforeSpanMs * r.minCoverShare) return null;
  const now = gainIn(runs, mark, mark + nowRead) / scale / (nowRead / MS_PER_MINUTE);
  const before = gainIn(runs, mark - beforeRead, mark) / scale / (beforeRead / MS_PER_MINUTE);
  return { now, before, last };
}

/**
 * One post's place on Trending now as a riser, or null when it is not one: its spans not measured,
 * under the floor, or under `minRatio` times its speed before. Freshness is the caller's: `fresh`
 * says it, the read service lists only fresh posts, the runner ranks as of each post's newest reading.
 */
export function riserPlace(id: string, readings: readonly SortReading[], postedMs: number | null, nowMs: number, policy: Policy, scale: number = 1): SortPlace | null {
  const r = policy.rising.forYouSorts.risers;
  const s = riserSpeeds(readings, nowMs, policy, scale);
  if (s === null || s.now < r.floorPerMin || s.now < r.minRatio * s.before) return null;
  const { runs } = runsOf(readings);
  return {
    id,
    gained: gainIn(runs, nowMs - r.nowSpanMs - r.beforeSpanMs, nowMs),
    key: s.before > 0 ? s.now / s.before : Infinity,
    group: 'over_floor',
    fresh: nowMs - s.last < policy.rising.forYouSorts.freshMs,
    speed: s.now,
    before: s.before,
    postedMs,
    postedKnown: postedMs !== null,
    lastReadMs: s.last,
  };
}

/**
 * Trending now in order: the risers by their ratio; when fewer than `fillBelow`, then the 1h rule's
 * picks over its floor (`fill`, already in that rule's order) not already listed, to `fillTo`. Both
 * lists come in as the caller placed them (fresh only, for the read service).
 */
export function trendingList(risers: readonly SortPlace[], fill: readonly SortPlace[], policy: Policy, ignoreFresh = false): readonly SortPlace[] {
  const r = policy.rising.forYouSorts.risers;
  const top = sortOrder(risers, risers.length, ignoreFresh);
  if (top.length >= r.fillBelow) return top;
  const taken = new Set(top.map((x) => x.id));
  const more = sortOrder(fill.filter((x) => x.group === 'over_floor' && !taken.has(x.id)), r.fillTo, ignoreFresh);
  return [...top, ...more].slice(0, Math.max(r.fillTo, top.length));
}

/**
 * One post's place on Most viewed over a span (Today, This week), or null when it is not on it.
 * `total` and `readMs` are its newest reading's count and time; `postedMs` its posted time, `seenMs`
 * when we first saw it, which stands in only when the posted time is unknown.
 */
export function viewedPlace(id: string, total: number | null, readMs: number | null, postedMs: number | null, seenMs: number | null, spanMs: number, nowMs: number, policy: Policy): SortPlace | null {
  const since = postedMs ?? seenMs;
  if (total === null || !Number.isFinite(total) || readMs === null || since === null || since < nowMs - spanMs) return null;
  return { id, gained: total, key: total, group: 'over_floor', speed: null, before: null, postedMs: since, postedKnown: postedMs !== null, lastReadMs: readMs, fresh: nowMs - readMs < policy.rising.forYouSorts.freshMs };
}

/** The window's Trending floor: its own entry, else the nearest window's; none at all, no floor. */
export function trendFloor(windowMs: number, policy: Policy): number {
  let best: { readonly windowMs: number; readonly perMin: number } | null = null;
  for (const f of policy.rising.forYouSorts.trendFloorsPerMin) {
    if (best === null || Math.abs(f.windowMs - windowMs) < Math.abs(best.windowMs - windowMs)) best = f;
  }
  return best?.perMin ?? 0;
}

const GROUP_ORDER: Readonly<Record<SortGroup, number>> = { over_floor: 0, under_floor: 1, no_trend: 2 };

/**
 * The list in order (see the header). `ignoreFresh` orders as if every post were read just now: what
 * the list would be with every post fresh, which the runner keeps fresh from.
 */
export function sortOrder(rows: readonly SortPlace[], shown: number, ignoreFresh = false): readonly SortPlace[] {
  const stale = (x: SortPlace): number => (ignoreFresh || x.fresh ? 0 : 1);
  const cmp = (a: number, b: number): number => (a === b ? 0 : b > a ? 1 : -1);
  return [...rows]
    .sort((a, b) =>
      stale(a) - stale(b) ||
      GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
      cmp(a.key, b.key) ||
      cmp(a.speed ?? -Infinity, b.speed ?? -Infinity) ||
      cmp(a.postedMs ?? -Infinity, b.postedMs ?? -Infinity) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, shown);
}
