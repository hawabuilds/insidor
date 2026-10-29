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
  /** The transaction it was in; null when the source did not say. */
  readonly tx: string | null;
  readonly side: 'buy' | 'sell';
  readonly tokenAmount: Measured;
  readonly usd: Measured;
  /** What one token went for in this trade, as the source reported it. */
  readonly priceUsd: Measured;
  readonly at: Instant;
  /** The wallet that made it; null when the source did not say. Compared with yours for "Mine". */
  readonly maker: string | null;
}

/** The token on the other side of the chart's pool, as the market names it. */
export interface PairToken {
  readonly address: string;
  readonly ticker: string | null;
  readonly name: string | null;
  readonly imageUrl: string | null;
  /** A tokenised stock (an xStock such as MSTRx), as its name and symbol both say. */
  readonly stock: boolean;
}

/** The pool the chart is drawn from: what the coin is paired with, where, and how deep. */
export interface MarketPair {
  /** Null when the market did not name the other side. */
  readonly token: PairToken | null;
  /** The dex by its own name ("PumpSwap", "Meteora"); `launchpad` when it is the launchpad's own. */
  readonly venue: { readonly name: string | null; readonly launchpad: boolean; readonly url: string | null };
  /** The pool's liquidity in dollars; on the launchpad curve, not reported. */
  readonly liquidityUsd: Measured;
}

export type CoinMarket =
  | {
      readonly kind: 'read';
      readonly timeframe: MarketTimeframe;
      /** Where it trades: still on the launchpad curve, a listed pool, or nowhere we can see. */
      readonly venue: 'curve' | 'pool' | null;
      /** Null when they could not be read; an empty list is "no trades yet". */
      readonly candles: readonly Candle[] | null;
      /**
       * Where the chart starts when our record of the coin began after its launch (ms); null when the chart
       * reaches its launch. A chart that starts mid-life says so on screen, never that the coin began there.
       */
      readonly chartFrom: number | null;
      readonly trades: readonly MarketTrade[] | null;
      /** 0..1 while on the curve; null when it is not on one. */
      readonly curveProgress: Measured | null;
      /** The chart's pool; null when the coin trades nowhere we can see. */
      readonly pair: MarketPair | null;
      /** The coin's own ticker and name as that pool lists them; null when it did not say. */
      readonly coin: { readonly ticker: string | null; readonly name: string | null } | null;
    }
  | { readonly kind: 'unavailable'; readonly timeframe: MarketTimeframe };
