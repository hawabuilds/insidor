/**
 * What the token page knows about a coin before its market is read — the one shape both ways in
 * (a narrative's coin, a searched coin) hand to TokenView and its Info tab.
 *
 * Its own file so the page and its panels can share the type without importing each other: the
 * Info tab is drawn by TokenView, and a type living in TokenView would make the two a cycle.
 *
 * What breaks if changed carelessly: an absent number stays `Measured` with its reason. Widening a
 * field to `number | null` would let a component print 0 for "not read".
 */

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
