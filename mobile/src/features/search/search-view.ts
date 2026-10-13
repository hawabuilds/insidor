/**
 * The Search screen's few decisions, apart from the screen so `node --test` can hold them:
 * how the coin list is ordered, what a coin's market line says, and when to say the list is
 * only the top of it.
 *
 * ★ AN UNKNOWN SORTS LAST, NEVER AS ZERO. A coin whose market cap no source reported is not a
 * coin worth nothing, and one with no launch time is not the oldest; both go below every coin
 * we can actually place, in the order the server sent them.
 */

import type { OriginGap, SearchCoin, SearchResults } from '../../shared/api/index.ts';

/** Biggest market cap first, newest launch first, or earliest launch first (the same-name list). */
export type CoinOrder = 'cap' | 'new' | 'first';

export function orderCoins(items: readonly SearchCoin[], by: CoinOrder): readonly SearchCoin[] {
  const key = (c: SearchCoin): number | null =>
    by === 'cap' ? (c.marketCapUsd.known ? c.marketCapUsd.amount : null) : c.launchedAt.known ? c.launchedAt.at : null;
  const down = by !== 'first';
  return items
    .map((c, i) => ({ c, i, k: key(c) }))
    .sort((a, b) => (a.k === null ? (b.k === null ? a.i - b.i : 1) : b.k === null ? -1 : (down ? b.k - a.k : a.k - b.k) || a.i - b.i))
    .map((x) => x.c);
}

/** "On curve 42%", "Bonded", or a dash with why: a coin no market lists has no known venue. */
export function marketLine(coin: SearchCoin): string {
  if (coin.venue === 'pool') return 'Bonded';
  if (coin.venue === null) return '— not listed by a market yet';
  const p = coin.curveProgress;
  return p !== null && p.known ? `On curve ${Math.round(p.amount * 100)}%` : 'On curve';
}

/** True when any section, or any source behind the coin list, cut its answer short. */
export function showingTop(results: SearchResults): boolean {
  return results.narratives.capped || results.posts.capped || (results.coins.kind === 'read' && results.coins.capped);
}

/** A past narrative's missing origin, in words. */
export const GAP_LINE: Record<OriginGap, string> = {
  not_searched_yet: '— origin not searched yet',
  origin_not_found: '— origin not found',
  possibly_deleted: '— origin possibly deleted',
  tiktok_not_searchable: '— origin on TikTok, not searchable yet',
};
