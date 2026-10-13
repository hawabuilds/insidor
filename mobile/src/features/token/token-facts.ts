/**
 * What the token page knows about a coin before its market is read — the one shape both ways in
 * (a narrative's coin, a searched coin) hand to TokenView and its Info tab.
 *
 * Its own file so the page and its panels can share the type, and the served market cap both
 * start from, without importing each other: the Info tab is drawn by TokenView, and either living
 * in TokenView would make the two a cycle.
 *
 * What breaks if changed carelessly: an absent number stays `Measured` with its reason. Widening a
 * field to `number | null` would let a component print 0 for "not read".
 */

import type { CoinAbout } from '../../shared/api/index.ts';
import type { Instant, Measured } from '../../shared/format/measure.ts';

/** What the page knows about the coin before its market is read. */
export interface TokenFacts {
  readonly coinId: string;
  readonly address: string;
  readonly ticker: string | null;
  readonly name: string | null;
  readonly imageUrl: string | null;
  readonly launchedAt: Instant;
  readonly price: Measured;
  readonly change24h: Measured;
  readonly marketCapUsd: Measured;
  /** Null where nothing has read it (a searched coin): the chip is left out rather than dashed. */
  readonly liquidityUsd: Measured | null;
  /** Where it trades, when known before the market is read. */
  readonly venue: 'curve' | 'pool' | null;
  /** The launchpad's name as the server says it. */
  readonly venueLabel: string;
  /** Whether a quote can be got now, as the server said; null when nothing has measured it. */
  readonly tradable: boolean | null;
}

/**
 * The cap the page's own replies carry, before any live price: the coin's read cap, else the
 * market profile's. The header and the Info tab both start from this, so they cannot differ.
 */
export function servedCap(facts: TokenFacts, about: CoinAbout | null): Measured {
  if (facts.marketCapUsd.known || about === null) return facts.marketCapUsd;
  return about.marketCapUsd.known ? about.marketCapUsd : facts.marketCapUsd;
}
