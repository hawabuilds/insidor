/**
 * WHICH POSTS THE READINGS LOOP KEEPS FRESH FOR FOR YOU'S SORTS (Policy.feed.readings.sortTop, the
 * owner's yeses of 2026-10-18: the text source's top 20, the short video's top 10). The read service lists a post last read 30 minutes ago or more below
 * every post read since (rising.forYouSorts.freshMs). Without this, a post that left the live frame
 * stops being read, and the post that should top Most viewed sinks for want of a reading rather
 * than for anything it did. So every `recomputeMs` this ranks For You's scroll on the lists the app
 * offers (the owner's third design, 2026-10-18: Trending now, Most viewed Today, This week and All
 * time; Policy.rising.forYouSorts) exactly as the read service does (core rank/post-sorts.ts, the one
 * copy of the rule) as if every post were read just now, and returns the text-source posts in any
 * list's top `topN` and the short videos in any list's top `shortVideoTopN` (Trending) or
 * `shortVideoViewedTopN` (Most viewed); readings.ts reads those whose newest reading is `everyMs` old.
 *
 * ★ MOST VIEWED Today and This week rank by views gained in the window from the readings; All time
 * by the card's own total (`views`, `readAtMs`: the projected card's `reach` and `readAt`), because
 * that is what the read service orders it by.
 * ★ TRENDING NOW IS THE RISERS, filled from the 1h rule under 5 (core `riserPlace`, `trendingList`),
 * ranked as of each post's own newest reading for the riser test: a post that was rising when last
 * read is in the top and is read again. Ranked at the moment asked, a post not read lately could
 * never measure the last 30 minutes and so could never be kept fresh.
 *
 * Its own file because it is a ranking over the whole scroll, not a cadence over one post, and it
 * reads a week of readings for every member (This week's gain needs them) — far too much for every
 * 30-second pass, so it is kept in memory between recomputes. A failure keeps the last set (or none) and says so once.
 *
 * What breaks if changed carelessly: ranking with freshness applied would only ever keep fresh the
 * posts already fresh; keeping short videos past `shortVideoTopN` spends credits the owner has not
 * agreed to (and Most viewed's own, smaller short-video top is what holds the redesign's extra
 * credits under the owner's ~$0.50 a day);
 * a list the app does not offer spends reads on a top nobody sees; and reading less than the window
 * and ranking Trending at the moment asked rather than at each post's newest reading keeps only the
 * posts already fresh.
 */

import type { ItemId, Millis, Observation, Policy } from '@insidor/contracts';
import { riserPlace, sortOrder, sortPlace, trendingList, viewedPlace, type SortPlace, type SortReading } from '@insidor/core';

import { errorText, type Logger } from '../log.ts';

/** The source whose re-reads are paid credits; its views are ranked at the policy's short-video scale (as readings.ts and the read service name it). */
const SHORT_VIDEO_SOURCE = 'tiktok';

export interface SortMember {
  readonly itemId: string;
  readonly source: string;
  readonly postedAt: number | null;
  /** When we first saw it: Most viewed's stand-in for an unknown posted time. */
  readonly firstSeenAt: number | null;
  /** The card's total views and when they were read; null when the card has none. */
  readonly views: number | null;
  readonly readAtMs: number | null;
}

/** A reading as the read service's card holds it (`sheet.counts`): a measured level, or a first reading's count. */
export function sortReadingOf(o: Observation): SortReading {
  if (o.rate.kind === 'measured') return { atMs: o.capturedAt, value: o.rate.level };
  return { atMs: o.capturedAt, value: o.rate.reason === 'no_prior' ? o.counter.value : null };
}

/** The 1h rule's window, the one Trending's fill comes from (as the read service takes it). */
const fillWindowMs = (p: Policy): number => p.rising.forYouSorts.trendFloorsPerMin[0]?.windowMs ?? 3_600_000;

/** The app's lists in order, ranked as if every post were read now: Trending now, then Most viewed Today, This week and All time. */
export function sortLists(members: readonly SortMember[], readings: ReadonlyMap<string, readonly SortReading[]>, nowMs: number, p: Policy): readonly (readonly SortPlace[])[] {
  const f = p.rising.forYouSorts;
  const scaleOf = (m: SortMember) => (m.source === SHORT_VIDEO_SOURCE ? p.rising.shortVideoReachScale : 1);
  const risers = members.flatMap((m) => {
    const r = readings.get(m.itemId) ?? [];
    const last = Math.max(-Infinity, ...r.filter((x) => x.value !== null).map((x) => x.atMs));
    /* As of its newest reading, and only if that reading could still be listed after a re-read. */
    if (!Number.isFinite(last) || nowMs - last >= 2 * f.freshMs) return [];
    const one = riserPlace(m.itemId, r, m.postedAt, Math.min(nowMs, last), p, scaleOf(m));
    return one === null ? [] : [one];
  });
  const windowed = (by: 'trending' | 'most_viewed', windowMs: number) => members.flatMap((m) => {
    const one = sortPlace(m.itemId, readings.get(m.itemId) ?? [], m.postedAt, by, windowMs, nowMs, p, by === 'trending' ? scaleOf(m) : 1);
    return one === null ? [] : [one];
  });
  const allTime = members.flatMap((m) => {
    const one = viewedPlace(m.itemId, m.views, m.readAtMs, m.postedAt, m.firstSeenAt, Infinity, nowMs, p);
    return one === null ? [] : [one];
  });
  const ordered = (xs: readonly SortPlace[]) => sortOrder(xs, xs.length, true);
  return [
    trendingList(risers, ordered(windowed('trending', fillWindowMs(p))), p, true),
    ordered(windowed('most_viewed', f.mostViewedSpansMs.today)),
    ordered(windowed('most_viewed', f.mostViewedSpansMs.week)),
    ordered(allTime),
  ];
}

/** The text posts in the top `topN` and the short videos in the top `shortVideoTopN` of any of the app's lists, ranked as if all were read now. */
export function sortTopIds(members: readonly SortMember[], readings: ReadonlyMap<string, readonly SortReading[]>, nowMs: number, p: Policy): ReadonlySet<string> {
  const top = new Set<string>();
  const { topN, shortVideoTopN: trendingVideoTopN, shortVideoViewedTopN } = p.feed.readings.sortTop;
  const isVideo = new Map(members.map((m) => [m.itemId, m.source === SHORT_VIDEO_SOURCE] as const));
  for (const [i, places] of sortLists(members, readings, nowMs, p).entries()) {
    /* Trending's short-video top is `shortVideoTopN`; Most viewed's is the smaller `shortVideoViewedTopN`. */
    const shortVideoTopN = i === 0 ? trendingVideoTopN : shortVideoViewedTopN;
    let text = 0;
    let video = 0;
    /* Each source's own top: the text top 20 and the video top 10 of the same list, counted apart. */
    for (const x of places) {
      if (isVideo.get(x.id) === true ? video++ < shortVideoTopN : text++ < topN) top.add(x.id);
      if (text >= topN && video >= shortVideoTopN) break;
    }
  }
  return top;
}

/**
 * The text-source members of the scroll's week still gaining when last read: the last two readings grew
 * at least `gaining.minGainPerHour` of the earlier count per hour, fastest first, `gaining.maxSet` at most.
 */
export function gainingIds(members: readonly SortMember[], readings: ReadonlyMap<string, readonly SortReading[]>, nowMs: number, p: Policy): ReadonlySet<string> {
  const g = p.feed.readings.gaining;
  if (!g.on) return new Set();
  const ranked = members.flatMap((m) => {
    if (m.source === SHORT_VIDEO_SOURCE) return [];
    const at = m.postedAt ?? m.firstSeenAt;
    if (at === null || nowMs - at > p.rising.scrollKeepMs) return [];
    const r = (readings.get(m.itemId) ?? []).filter((x): x is SortReading & { value: number } => x.value !== null).sort((a, b) => a.atMs - b.atMs);
    const last = r[r.length - 1];
    const before = r[r.length - 2];
    if (last === undefined || before === undefined || before.value <= 0 || last.atMs <= before.atMs) return [];
    const perHour = (last.value - before.value) / before.value / ((last.atMs - before.atMs) / 3_600_000);
    return perHour >= g.minGainPerHour ? [{ id: m.itemId, perHour }] : [];
  });
  return new Set(ranked.sort((a, b) => b.perHour - a.perHour).slice(0, g.maxSet).map((x) => x.id));
}

export interface SortTopDeps {
  readonly members: () => Promise<readonly SortMember[]>;
  readonly series: (itemIds: readonly ItemId[], sinceMs: Millis) => Promise<ReadonlyMap<ItemId, readonly Observation[]>>;
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

/**
 * The set, recomputed at most every `recomputeMs`; the last good one is kept when a recompute fails.
 * `.gaining()` is the still-gaining set from the same recompute (`gainingIds`): one week of readings
 * read once for both.
 */
export function sortTop(deps: SortTopDeps): (() => Promise<ReadonlySet<string>>) & { readonly gaining: () => ReadonlySet<string> } {
  let kept: { readonly at: number; readonly ids: ReadonlySet<string>; readonly gaining: ReadonlySet<string> } | null = null;
  let warned = false;
  const get = async (): Promise<ReadonlySet<string>> => {
    const p = deps.policy;
    const now = deps.now();
    if (kept !== null && now - kept.at < p.feed.readings.sortTop.recomputeMs) return kept.ids;
    try {
      const members = await deps.members();
      const f = p.rising.forYouSorts;
      /* This week's gain, and the reading before the week began (a twelfth more, as the read service's card has it). */
      const back = f.mostViewedSpansMs.week + f.mostViewedSpansMs.week / f.minReadShare;
      const series = await deps.series(members.map((m) => m.itemId as ItemId), (now - back) as Millis);
      const readings = new Map([...series].map(([id, obs]) => [id as string, obs.filter((o) => o.kind === 'reach').map(sortReadingOf)] as const));
      kept = { at: now, ids: sortTopIds(members, readings, now, p), gaining: gainingIds(members, readings, now, p) };
      warned = false;
    } catch (e) {
      if (!warned) deps.log.warn("the sorts' top posts could not be ranked; kept the last set", { err: errorText(e) });
      warned = true;
      kept = { at: now, ids: kept?.ids ?? new Set(), gaining: kept?.gaining ?? new Set() };
    }
    return kept.ids;
  };
  return Object.assign(get, { gaining: (): ReadonlySet<string> => kept?.gaining ?? new Set<string>() });
}
