/**
 * WHICH TEXT-SOURCE POSTS THE READINGS LOOP KEEPS FRESH FOR FOR YOU'S SORTS (Policy.feed.readings.sortTop,
 * the owner's yes of 2026-10-18). The read service lists a post last read 30 minutes ago or more below
 * every post read since (rising.forYouSorts.freshMs). Without this, a post that left the live frame
 * stops being read, and the post that should top Most viewed 24h sinks for want of a reading rather
 * than for anything it did. So every `recomputeMs` this ranks For You's scroll on every sort and window
 * exactly as the read service does (core rank/post-sorts.ts, the one copy of the rule) as if every
 * post were read just now, and returns the text-source posts in any list's top `topN`; readings.ts
 * reads those whose newest reading is `everyMs` old.
 *
 * Its own file because it is a ranking over the whole scroll, not a cadence over one post, and it
 * reads a day of readings for every member — far too much for every 30-second pass, so it is kept in
 * memory between recomputes. A failure keeps the last set (or none) and says so once.
 *
 * What breaks if changed carelessly: ranking with freshness applied would only ever keep fresh the
 * posts already fresh; letting the short-video source in spends credits the owner has not agreed to;
 * and reading less than a window back makes a 24-hour gain start at the wrong reading.
 */

import type { ItemId, Millis, Observation, Policy } from '@insidor/contracts';
import { sortOrder, sortPlace, type PostSortBy, type SortReading } from '@insidor/core';

import { errorText, type Logger } from '../log.ts';

/** The source whose re-reads are paid credits; its views are ranked at the policy's short-video scale (as readings.ts and the read service name it). */
const SHORT_VIDEO_SOURCE = 'tiktok';
const SORTS: readonly PostSortBy[] = ['most_viewed', 'trending'];

export interface SortMember {
  readonly itemId: string;
  readonly source: string;
  readonly postedAt: number | null;
}

/** A reading as the read service's card holds it (`sheet.counts`): a measured level, or a first reading's count. */
export function sortReadingOf(o: Observation): SortReading {
  if (o.rate.kind === 'measured') return { atMs: o.capturedAt, value: o.rate.level };
  return { atMs: o.capturedAt, value: o.rate.reason === 'no_prior' ? o.counter.value : null };
}

/** The text-source posts in the top `topN` of any sort and window, ranked as if all were read now. */
export function sortTopIds(members: readonly SortMember[], readings: ReadonlyMap<string, readonly SortReading[]>, nowMs: number, p: Policy): ReadonlySet<string> {
  const top = new Set<string>();
  const n = p.feed.readings.sortTop.topN;
  for (const by of SORTS) {
    for (const windowMs of p.feed.readings.sortTop.windowsMs) {
      const places = members.flatMap((m) => {
        const scale = m.source === SHORT_VIDEO_SOURCE ? p.rising.shortVideoReachScale : 1;
        const one = sortPlace(m.itemId, readings.get(m.itemId) ?? [], m.postedAt, by, windowMs, nowMs, p, scale);
        return one === null ? [] : [one];
      });
      for (const x of sortOrder(places, n, true)) top.add(x.id);
    }
  }
  const source = new Map(members.map((m) => [m.itemId, m.source] as const));
  return new Set([...top].filter((id) => source.get(id) !== SHORT_VIDEO_SOURCE));
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
      const longest = Math.max(...p.feed.readings.sortTop.windowsMs);
      /* The longest window and a twelfth more (26 hours): a gain at the window's start needs the reading
         before it. A gap longer than that before the window counts from the first reading after it,
         a little under what the read service, which has every reading on the card, counts. */
      const series = await deps.series(members.map((m) => m.itemId as ItemId), (now - longest - longest / p.rising.forYouSorts.minReadShare) as Millis);
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
