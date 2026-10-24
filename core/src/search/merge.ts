/**
 * ONE COIN PER ADDRESS, FROM SEVERAL SEARCH SOURCES.
 *
 * Two market data sources answer the same name search, and each knows a different half of a
 * coin: one has the picture and the full name, the other only the ticker from its market's name.
 * Merged on the address, which is the one thing both spell the same way, every field is the
 * first source's that has it and the gaps are filled from the next. A field neither has stays
 * missing; it is never filled with a guess.
 *
 * ★ A BONDED MARKET OUTRANKS A CURVE ONE. A coin that graduated has both a dead curve market and
 * a live pool, and a source that still lists the curve would otherwise say "on curve" about a
 * coin that left it. The venue, and the market account that goes with it, come from the pool.
 *
 * ★ THE LAUNCH IS THE EARLIEST TIME ANY SOURCE KNOWS (the owner, 2026-10-24: $MEMEWAR showed 15:11,
 * its pool's creation, against a 12:32 launch). A graduated coin's pool is made when it leaves the
 * curve, after the coin launched; the earlier of the two answers, and our own launch index when it is
 * merged in, is the coin's launch.
 *
 * Shared by the background lookup (runner) and the live search (read), so a coin is merged the
 * same way whether it was searched for a story or by a person.
 */

import type { CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';

/** The earlier of two times; either may be missing. */
function earliest<T extends CoinSearchHit['createdAt']>(a: T, b: T): T {
  if (a === null || a === undefined) return b;
  if (b === null || b === undefined) return a;
  return (b < a ? b : a) as T;
}

export function mergeHits(lists: readonly (readonly CoinSearchHit[])[]): readonly CoinSearchHit[] {
  const byAddress = new Map<string, CoinSearchHit>();
  for (const hit of lists.flat()) {
    const held = byAddress.get(hit.address);
    if (held === undefined) {
      byAddress.set(hit.address, hit);
      continue;
    }
    const [first, second] = held.venue === 'curve' && hit.venue === 'pool' ? [hit, held] : [held, hit];
    byAddress.set(hit.address, {
      ...first,
      name: first.name ?? second.name,
      ticker: first.ticker ?? second.ticker,
      marketAddress: first.marketAddress ?? (first.venue === second.venue ? second.marketAddress : null),
      createdAt: earliest(first.createdAt, second.createdAt),
      marketCapUsd: first.marketCapUsd ?? second.marketCapUsd,
      imageUrl: first.imageUrl ?? second.imageUrl,
    });
  }
  return [...byAddress.values()];
}
