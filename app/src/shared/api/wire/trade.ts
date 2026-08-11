/**
 * THE QUOTE — what the user is actually agreeing to.
 *
 * The costs are an array and the panel renders the array. There is no `fee` field and no
 * place to put one, because a fixed "0.50% fee" line is a lie: measured all-in cost ranged
 * 1.60% to 22.72% across three same-age mints. A confirm sheet that renders an itemised
 * array cannot show a hardcoded number, and one that renders `quote.feeBps` inevitably does.
 *
 * `expiresAt` is not decoration either. A quote on this chain is backed by a blockhash that
 * dies in about a minute, so an expired quote must become unusable in the type rather than
 * merely look stale — see `TradeIntent`, which a component can only build from a live quote.
 */

import type { Instant, Measured } from '../../format/measure.ts';
import type { Coin } from './coin.ts';

/**
 * A cost line. `code` is closed so the panel can order and group them; `label` is the words
 * the server chose, because a component inventing wording for a money line is how a fee
 * gets described wrongly.
 */
export interface TradeCost {
  readonly code: 'network' | 'priority' | 'rent' | 'venue' | 'price-impact' | 'aggregator' | 'platform';
  readonly label: string;
  readonly amountUsd: Measured;
  readonly bps: Measured;
  /** Per cost, not per quote. Some of what you pay comes back; most of it does not. */
  readonly refundable: boolean;
}

export interface TradeQuote {
  readonly quoteId: string;
  readonly coin: Coin;
  readonly side: 'buy';

  /**
   * Amounts are strings, in the smallest unit, exactly as the venue expressed them. Not
   * numbers: 1e18 does not fit in a float64 and a rounded amount is a wrong amount. The
   * panel renders `*Display` for humans and passes the raw strings to the executor.
   */
  readonly inAmountRaw: string;
  readonly outExpectedRaw: string;
  readonly outMinimumRaw: string;
  readonly inDisplay: string;
  readonly outExpectedDisplay: string;

  readonly slippageBps: number;
  readonly costs: readonly TradeCost[];
  /** The sum the user is judged on. Present separately because the panel leads with it. */
  readonly allInBps: Measured;
  readonly priceImpactBps: Measured;

  readonly expiresAt: Instant;
  readonly expiryReason: 'blockhash' | 'ttl' | 'none';
  /** Never cached: the venue changes the moment a coin graduates off its curve. */
  readonly route: readonly { readonly label: string }[];
}

/**
 * What the user pressed confirm on.
 *
 * Constructed only from a quote the panel currently holds and only after an explicit
 * confirmation, so "I meant to review it, not buy it" cannot be one click.
 */
export interface TradeIntent {
  readonly quoteId: string;
  readonly coinId: string;
  readonly acceptedAt: number;
}

/** What comes back. `submitted` is not `filled`; conflating them is how a UI lies. */
export type TradeResult =
  | { readonly kind: 'submitted'; readonly reference: string }
  | { readonly kind: 'filled'; readonly reference: string; readonly filledUsd: Measured }
  | { readonly kind: 'rejected'; readonly message: string }
  | { readonly kind: 'expired' };
