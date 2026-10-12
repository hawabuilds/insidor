/**
 * A coin found by searching a market data source by name or ticker — a CANDIDATE, nothing more.
 *
 * Search is how we find coins the mint stream never told us about: launched before we were
 * watching, or on the curve and never traded through a pool we read. A hit says a coin with this
 * name exists, where it trades and roughly how big it is. ★ IT NEVER LINKS A COIN TO A STORY OR
 * A POST: a hit goes into the coin universe and through the same checks as any other coin
 * (picture, name, timing). Search results that named a coin directly would put every same-named
 * coin on a story.
 *
 * Every number may be missing; missing is null, never zero.
 */

export interface CoinSearchHit {
  /** The coin's address on its chain. The key results are merged on. */
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  /** Still on its launchpad's bonding curve, or trading in a listed pool. */
  readonly venue: 'curve' | 'pool';
  /** When its market was created — for a curve coin, its launch. */
  readonly createdAt: number | null;
  readonly marketCapUsd: number | null;
  /** The source's own copy of the picture, for a search list only — never stored as the coin's. */
  readonly imageUrl: string | null;
  /** Which source found it. */
  readonly source: string;
}

export interface CoinSearch {
  /** Coins on the launchpad matching a term, newest market first; `capped` when the source cut the list. */
  search(term: string): Promise<{ readonly hits: readonly CoinSearchHit[]; readonly capped: boolean }>;
}
