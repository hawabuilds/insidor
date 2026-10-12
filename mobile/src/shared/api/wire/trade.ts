/**
 * The trade service's replies, as the phone app holds them (services/trade/src/routes.ts).
 *
 * ★ A QUOTE IS KEPT WHOLE. The fields the order sheet shows are read out of it, and the quote
 * itself (`sent`) goes back to the build exactly as it came — the app never edits a price.
 */

export type TradeVenue = 'curve' | 'pool' | 'none' | 'unavailable';

export interface TradeQuote {
  readonly venue: 'curve' | 'pool';
  readonly side: 'buy' | 'sell';
  /** Base units, as decimal strings: buy spends lamports in, sell spends token units in. */
  readonly inAmount: string;
  readonly outAmount: string;
  /** Buy on the curve: the most it can spend. Otherwise: the least it can return. */
  readonly bound: string;
  readonly slippageBps: number;
  readonly priceImpactPct: number | null;
  /** The quote as the server sent it, returned to the build unchanged. */
  readonly sent: unknown;
}

export type BuildResult =
  | { readonly kind: 'ready'; readonly transaction: string }
  | { readonly kind: 'blocked'; readonly why: string };

export interface Holding {
  readonly amount: string;
  readonly decimals: number;
}
