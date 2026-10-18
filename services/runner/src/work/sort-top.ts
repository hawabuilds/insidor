/**
 * WHICH POSTS THE READINGS LOOP KEEPS FRESH FOR FOR YOU'S SORTS (Policy.feed.readings.sortTop, the
 * owner's yeses of 2026-10-18: the text source's top 20, the short video's top 10). The read service lists a post last read 30 minutes ago or more below
 * every post read since (rising.forYouSorts.freshMs). Without this, a post that left the live frame
 * stops being read, and the post that should top Most viewed sinks for want of a reading rather
 * than for anything it did. So every `recomputeMs` this ranks For You's scroll on the lists the app
 * offers (the owner, 2026-10-18: Trending now, Most viewed Today, Most viewed This week;
 * Policy.rising.forYouSorts) exactly as the read service does (core rank/post-sorts.ts, the one copy
 * of the rule) as if every post were read just now, and returns the text-source posts in any list's
 * top `topN` and the short videos in any list's top `shortVideoTopN`; readings.ts reads those whose
 * newest reading is `everyMs` old.
 *
 * ★ MOST VIEWED IS RANKED ON THE CARD'S OWN TOTAL (`views`, `readAtMs`: the projected card's `reach`
 * and `readAt`), because that is what the read service orders it by; so a post read three days ago
 * with the week's biggest total is in the week's top and is read again. Trending needs the
 * readings of its one window and a twelfth more, so that is all the series asks for.
 *
 * Its own file because it is a ranking over the whole scroll, not a cadence over one post, and it
 * reads an hour of readings for every member — too much for every 30-second pass, so it is kept in
 * memory between recomputes. A failure keeps the last set (or none) and says so once.
 *
 * What breaks if changed carelessly: ranking with freshness applied would only ever keep fresh the
 * posts already fresh; keeping short videos past `shortVideoTopN` spends credits the owner has not
 * agreed to (and Most viewed's own, smaller short-video top is what holds the redesign's extra
 * credits under the owner's ~$0.50 a day);
 * a list the app does not offer spends reads on a top nobody sees; and reading less than the window
 * and its twelfth back makes Trending's earlier half start at the wrong reading.
 */

import type { ItemId, Millis, Observation, Policy } from '@insidor/contracts';
import { sortOrder, sortPlace, viewedPlace, type SortPlace, type SortReading } from '@insidor/core';

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

/** The app's lists, each as its places: Trending now, Most viewed Today, Most viewed This week. */
export function sortLists(members: readonly SortMember[], readings: ReadonlyMap<string, readonly SortReading[]>, nowMs: number, p: Policy): readonly (readonly SortPlace[])[] {
  const f = p.rising.forYouSorts;
  const trending = members.flatMap((m) => {
    const scale = m.source === SHORT_VIDEO_SOURCE ? p.rising.shortVideoReachScale : 1;
    const one = sortPlace(m.itemId, readings.get(m.itemId) ?? [], m.postedAt, 'trending', f.trendingWindowMs, nowMs, p, scale);
    return one === null ? [] : [one];
  });
  const viewed = (spanMs: number) => members.flatMap((m) => {
    const one = viewedPlace(m.itemId, m.views, m.readAtMs, m.postedAt, m.firstSeenAt, spanMs, nowMs, p);
    return one === null ? [] : [one];
  });
  return [trending, viewed(f.mostViewedSpansMs.today), viewed(f.mostViewedSpansMs.week)];
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
    for (const x of sortOrder(places, places.length, true)) {
      if (isVideo.get(x.id) === true ? video++ < shortVideoTopN : text++ < topN) top.add(x.id);
      if (text >= topN && video >= shortVideoTopN) break;
    }
  }
  return top;
}

export interface SortTopDeps {
  readonly members: () => Promise<readonly SortMember[]>;
  readonly series: (itemIds: readonly ItemId[], sinceMs: Millis) => Promise<ReadonlyMap<ItemId, readonly Observation[]>>;
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

/** The set, recomputed at most every `recomputeMs`; the last good one is kept when a recompute fails. */
export function sortTop(deps: SortTopDeps): () => Promise<ReadonlySet<string>> {
  let kept: { readonly at: number; readonly ids: ReadonlySet<string> } | null = null;
  let warned = false;
  return async () => {
    const p = deps.policy;
    const now = deps.now();
    if (kept !== null && now - kept.at < p.feed.readings.sortTop.recomputeMs) return kept.ids;
    try {
      const members = await deps.members();
      const w = p.rising.forYouSorts.trendingWindowMs;
      /* Trending's window and a twelfth more (65 minutes): a gain at the window's start needs the reading
         before it. A gap longer than that before the window counts from the first reading after it,
         a little under what the read service, which has every reading on the card, counts. */
      const series = await deps.series(members.map((m) => m.itemId as ItemId), (now - w - w / p.rising.forYouSorts.minReadShare) as Millis);
      const readings = new Map([...series].map(([id, obs]) => [id as string, obs.filter((o) => o.kind === 'reach').map(sortReadingOf)] as const));
      kept = { at: now, ids: sortTopIds(members, readings, now, p) };
      warned = false;
    } catch (e) {
      if (!warned) deps.log.warn("the sorts' top posts could not be ranked; kept the last set", { err: errorText(e) });
      warned = true;
      kept = { at: now, ids: kept?.ids ?? new Set() };
    }
    return kept.ids;
  };
}
