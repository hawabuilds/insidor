/**
 * Rendering a discovery query into this vendor's search syntax.
 *
 * The query names ONE mode and one term, because discovery verbs do not line up
 * across sources: a uniform `search(query)` returns an empty result on a source
 * that cannot search, and an empty result reads downstream as "nothing is
 * happening" — the exact failure the capability list exists to design out. So a
 * mode this source cannot express is an error here, not an empty page.
 */

import type { Item, Millis } from '@insidor/contracts';
import type { DiscoveryQuery } from '@insidor/contracts/ports/platform.ts';
import { NotImplemented } from '@insidor/vendor-kit';

import { CAPABILITIES } from './capabilities.ts';
import type { XClient } from './client.ts';
import { toItem } from './to-item.ts';

const isoDay = (ms: Millis): string => new Date(ms).toISOString().slice(0, 10);

export function toSearchQuery(query: DiscoveryQuery): string {
  if (!CAPABILITIES.discovery.includes(query.mode)) {
    throw new NotImplemented(`x:discover:${query.mode}`, 'this source has no such entry point');
  }

  const term = query.term.trim();
  if (term.length === 0) {
    throw new NotImplemented('x:discover', 'this source has no "everything" feed');
  }

  const parts: string[] = [];
  parts.push(query.mode === 'account' ? `from:${term}` : term.includes(' ') ? `"${term}"` : term);
  // A language filter is expressible and deliberately NOT applied: pinning it
  // to one language is what made every non-English story invisible.
  if (query.sinceMs !== null) parts.push(`since:${isoDay(query.sinceMs)}`);
  // The cutoff is pushed into the query, never applied to the response. Filtering
  // after the fact still spends budget on results we must not look at, and a result
  // that reached this process has already had the chance to leak into a decision.
  //
  // until_time takes unix SECONDS and is exact. The day-granularity `until:` operator
  // is not good enough here: a coin minted at 09:02 would still see everything else
  // posted that day, which is up to 24 hours of the crowd reacting to the coin —
  // precisely the contamination the cutoff exists to prevent.
  if (query.untilMs !== null) parts.push(`until_time:${Math.floor(query.untilMs / 1000)}`);
  return parts.join(' ');
}

/** One page of search results, translated. The client is the only paid line. */
export async function searchPage(
  client: XClient,
  query: DiscoveryQuery,
  at: Millis,
): Promise<{
  readonly items: readonly Item[];
  readonly cursor: string | null;
  readonly hasMore: boolean;
  readonly units: number;
}> {
  const page = await client.search(toSearchQuery(query), query.cursor);
  const items = page.items.slice(0, query.limit).map((raw) => toItem(raw, at));
  return {
    items,
    cursor: page.cursor,
    // The vendor said so, or it did not. We never infer it from a page size.
    hasMore: page.hasMore,
    // Billed per item returned, so the unit count is what came back — measured,
    // not estimated, which is the entire point of reporting it from here.
    units: page.items.length,
  };
}
