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

import type { Author, Item, Policy } from '@insidor/contracts';
import { withTextHash } from '@insidor/core';
import type { PgAuthorRepo, PgItemRepo } from '@insidor/store';

export function storeArrivals(
  repos: { readonly authors: PgAuthorRepo; readonly items: PgItemRepo },
  policy: Policy,
): (items: readonly Item[], authors: readonly Author[]) => Promise<number> {
  return async (items, authors) => {
    await repos.authors.upsert(authors);
    return repos.items.upsert(items.map((item) => withTextHash(item, policy)));
  };
}
