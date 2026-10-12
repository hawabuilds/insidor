/**
 * How a discovery page is stored: the accounts first, then the posts, with each post's text
 * phrases folded into one hash.
 *
 * Its own file so the runner's wiring and the end-to-end test store a page the same way;
 * a copy in the test would prove a sequence production does not run.
 *
 * What breaks if the order changes: a post stored before its author would create a bare
 * author row with no handle, and a story page could not cite that post until the next read.
 */

import type { Author, Item, Millis, Policy } from '@insidor/contracts';
import type { FeedLane } from '@insidor/contracts/ports/platform.ts';
import { latestCounters, observationsFrom, withTextHash } from '@insidor/core';
import type { PgAuthorRepo, PgItemRepo, PgObservationRepo } from '@insidor/store';

const MS_PER_HOUR = 3_600_000;

export function storeArrivals(
  repos: { readonly authors: PgAuthorRepo; readonly items: PgItemRepo; readonly observations: PgObservationRepo },
  policy: Policy,
  now: () => Millis,
): (items: readonly Item[], authors: readonly Author[], lane?: FeedLane | null) => Promise<number> {
  return async (items, authors, lane = null) => {
    await repos.authors.upsert(authors);
    const stored = await repos.items.upsert(items.map((item) => withTextHash(item, policy)));
    /* Which catch-all lane found these, for the per-post score and the For You feed (0025).
       A keyword search writes nothing here, and that is what keeps its posts off the feed. */
    if (lane !== null) await repos.items.markFoundBy(items.map((item) => item.itemId), lane, now());

    /* ★ THE READING DISCOVERY ALREADY PAID FOR. A search result carries each post's counts,
       and they are a real reading taken the moment we fetched it. Saved as observations
       here, every post has its views from the first minute — and the one reading a post
       off screen ever gets — without a single extra call. A post found again on a later
       pass gets a second reading the same way, against the first. */
    const ids = items.map((item) => item.itemId);
    const earlier = await repos.observations.seriesForItems(ids, (now() - policy.track.maxTrackedHours * MS_PER_HOUR) as Millis);
    for (const item of items) {
      const counters = Object.values(item.counters).filter((c) => c !== undefined);
      if (counters.length === 0) continue;
      const capturedAt = Math.max(...counters.map((c) => c.observedAt)) as Millis;
      await repos.observations.append(
        observationsFrom(item.itemId, item.counters, latestCounters(earlier.get(item.itemId) ?? []), capturedAt, policy.kinetics),
      );
    }
    return stored;
  };
}
