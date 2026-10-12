/**
 * A COIN'S MARKET — its price history for one view, its latest trades, and, while it is on the
 * launchpad's curve, how far along it is. `GET /coin/:coinId/market?tf=`.
 *
 * Facts about trading, read when the token page opens. `unavailable` is the source failing —
 * shown as a dash with a reason, never as a coin nobody trades. An empty `candles` array is the
 * other fact: the coin has no trades in this view yet.
 */

import type { Instant, Measured } from '../../format/measure.ts';

/** Trador's six views. */
export type MarketTimeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1D';

export interface Candle {
  readonly t: number;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
}

export interface MarketTrade {
  /** The transaction it was in; null only for sample trades, which invent none. */
  readonly tx: string | null;
  readonly side: 'buy' | 'sell';
  readonly tokenAmount: Measured;
  readonly usd: Measured;
  /** What one token went for in this trade, as the source reported it. */
  readonly priceUsd: Measured;
  readonly at: Instant;
}

export type CoinMarket =
  | {
      readonly kind: 'read';
      readonly timeframe: MarketTimeframe;
      /** Where it trades: still on the launchpad curve, a listed pool, or nowhere we can see. */
      readonly venue: 'curve' | 'pool' | null;
      /** Null when they could not be read; an empty list is "no trades yet". */
      readonly candles: readonly Candle[] | null;
      readonly trades: readonly MarketTrade[] | null;
      /** 0..1 while on the curve; null when it is not on one. */
      readonly curveProgress: Measured | null;
    }
  | { readonly kind: 'unavailable'; readonly timeframe: MarketTimeframe };
