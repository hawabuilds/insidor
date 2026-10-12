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
import { withTextHash } from '@insidor/core';
import type { PgAuthorRepo, PgItemRepo } from '@insidor/store';

export function storeArrivals(
  repos: { readonly authors: PgAuthorRepo; readonly items: PgItemRepo },
  policy: Policy,
  now: () => Millis,
): (items: readonly Item[], authors: readonly Author[], lane?: FeedLane | null) => Promise<number> {
  return async (items, authors, lane = null) => {
    await repos.authors.upsert(authors);
    const stored = await repos.items.upsert(items.map((item) => withTextHash(item, policy)));
    /* Which catch-all lane found these, for the per-post score and the For You feed (0025).
       A keyword search writes nothing here, and that is what keeps its posts off the feed. */
    if (lane !== null) await repos.items.markFoundBy(items.map((item) => item.itemId), lane, now());
    return stored;
  };
}
