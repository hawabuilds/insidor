/**
 * "MC +12%" IN THE FACT LINE — how much the coin's market cap moved over the chart's chosen
 * interval, read from the coin's own trades (the token page's market read, `GET /coin/:id/market`),
 * on the narrative page and the post sheet. Apart from the screens so `node --test` holds the rule.
 *
 * ★ THE MOVE IS PRICE AGAINST PRICE: the newest candle's close against the close of the last candle
 * that ended at least one interval before it. Supply does not change, so the cap moves by the same
 * percent; no supply is assumed. The candles are one size finer than the interval (`TIMEFRAME_FOR`),
 * so "the last 15m" is fifteen one-minute candles, not one fifteen-minute candle half gone.
 *
 * ★ HIDDEN UNTIL THE COIN HAS ENOUGH TRADES (the owner's rule for new coins): at least `MIN_TRADES`
 * trades in the market's latest list, and a candle a whole interval back to compare with. A coin a
 * few minutes old with three buys would show "+900%", a fact about three wallets, not a market.
 *
 * What breaks if changed carelessly: comparing with the first candle of the window instead of one
 * that ended before it measures less than the interval and calls it the interval.
 */

import type { CoinMarket, MarketTimeframe } from '../../shared/api/index.ts';
import type { GainInterval } from './gain-chart.ts';

const MINUTE = 60_000;

/** The fewest trades the market's latest list must hold before a move is said. */
export const MIN_TRADES = 20;

/** The candles each interval is measured on: one size finer. */
export const TIMEFRAME_FOR: Readonly<Record<GainInterval, MarketTimeframe>> = { '5m': '1m', '15m': '1m', '1h': '5m', '4h': '15m', '1D': '1h' };
const TF_MS: Readonly<Record<MarketTimeframe, number>> = { '1m': MINUTE, '5m': 5 * MINUTE, '15m': 15 * MINUTE, '1h': 60 * MINUTE, '4h': 240 * MINUTE, '1D': 1_440 * MINUTE };
const INTERVAL_MS: Readonly<Record<GainInterval, number>> = { '5m': 5 * MINUTE, '15m': 15 * MINUTE, '1h': 60 * MINUTE, '4h': 240 * MINUTE, '1D': 1_440 * MINUTE };

/** The move in percent (12 is up 12%), or null: not enough trades, or nothing a whole interval back. */
export function mcChange(market: CoinMarket, interval: GainInterval): number | null {
  if (market.kind !== 'read' || market.candles === null || market.trades === null) return null;
  if (market.trades.length < MIN_TRADES) return null;
  const tf = TF_MS[market.timeframe];
  const candles = [...market.candles].filter((c) => c.c > 0).sort((a, b) => a.t - b.t);
  const newest = candles[candles.length - 1];
  if (newest === undefined) return null;
  const cut = newest.t + tf - INTERVAL_MS[interval];
  const back = candles.filter((c) => c.t + tf <= cut).pop();
  if (back === undefined) return null;
  return (newest.c / back.c - 1) * 100;
}

/** "+12%", "-4.5%", "+0.3%". */
export function pctText(p: number): string {
  const a = Math.abs(p);
  const n = a >= 10 ? Math.round(a).toString() : a.toFixed(1);
  return `${p >= 0 ? '+' : '-'}${n}%`;
}
