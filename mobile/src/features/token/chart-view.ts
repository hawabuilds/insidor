/**
 * WHICH VIEW THE TOKEN CHART SHOWS, AND WHAT EACH ONE READS (the owner, 2026-10-27, after pump.fun's
 * chart: "our chart is currently zoomed in especially for new tokens"). A view is a timeframe the
 * market source serves, or one of two of our own:
 *
 *   All  the coin's whole life since launch, at the candle size that fits it in about
 *        `ALL_TARGET_BARS` candles: a coin an hour old in 1m candles, a week-old one in 1h. The
 *        first view for a coin on its curve or under a day old.
 *   1s   one-second candles built from the latest trades the page holds (the source serves 1m at
 *        its finest): for a coin minutes old, where a minute is a long time.
 *
 * Pure and its own file, so the token page, the chart and `node --test` read one rule.
 *
 * What breaks if changed carelessly: `fetchTimeframe` must always name a timeframe the source
 * serves; '1s' and 'all' are never sent to it.
 */

import type { MarketTrade, MarketTimeframe } from '../../shared/api/index.ts';
import { TIMEFRAME_MS, isPlausiblePrice, type ChartPoint } from './chart-data.ts';

export type ChartView = '1s' | MarketTimeframe | 'all';

/** The rail, in its order: the fine views first and All last, as pump.fun's. */
export const VIEWS: readonly ChartView[] = ['1s', '1m', '5m', '1h', '1D', 'all'];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A coin younger than this opens on All. */
const YOUNG_MS = DAY;

/** The candle size that fits a coin's life in about a hundred and twenty candles. */
export function allTimeframe(ageMs: number | null): MarketTimeframe {
  if (ageMs === null || !Number.isFinite(ageMs) || ageMs < 0) return '1h';
  if (ageMs <= 2 * HOUR) return '1m';
  if (ageMs <= 10 * HOUR) return '5m';
  if (ageMs <= 30 * HOUR) return '15m';
  if (ageMs <= 5 * DAY) return '1h';
  if (ageMs <= 20 * DAY) return '4h';
  return '1D';
}

/** What is asked of the market source for a view. */
export function fetchTimeframe(view: ChartView, ageMs: number | null): MarketTimeframe {
  if (view === '1s') return '1m';
  if (view === 'all') return allTimeframe(ageMs);
  return view;
}

/** One candle's length on screen, in ms. */
export function periodMs(view: ChartView, ageMs: number | null): number {
  return view === '1s' ? 1_000 : TIMEFRAME_MS[fetchTimeframe(view, ageMs)];
}

/** The first view: All for a coin on its curve or under a day old, else 1h. */
export function defaultView(r: { readonly onCurve: boolean; readonly launchedAt: number | null; readonly now: number }): ChartView {
  if (r.onCurve) return 'all';
  if (r.launchedAt !== null && r.now - r.launchedAt >= 0 && r.now - r.launchedAt < YOUNG_MS) return 'all';
  return '1h';
}

export const viewLabel = (v: ChartView): string => (v === 'all' ? 'All' : v);

/** A trade under this many dollars is an indexer's dust, not a fill (chart-data.ts's own floor). */
const MIN_FILL_USD = 1e-6;

/** Candles of `bucketMs` built from trades alone, oldest first; a bad print is left out. */
export function tradesToCandles(trades: readonly MarketTrade[], bucketMs: number): ChartPoint[] {
  const fills = trades
    .flatMap((t) => (t.at.known && t.priceUsd.known && t.usd.known && t.usd.amount > MIN_FILL_USD && isPlausiblePrice(t.priceUsd.amount) ? [{ t: t.at.at as number, price: t.priceUsd.amount }] : []))
    .sort((a, b) => a.t - b.t);
  const out: ChartPoint[] = [];
  for (const f of fills) {
    const t = Math.floor(f.t / bucketMs) * bucketMs;
    const last = out[out.length - 1];
    if (last !== undefined && !isPlausiblePrice(f.price, last.price)) continue;
    if (last !== undefined && last.t === t) {
      out[out.length - 1] = { ...last, price: f.price, high: Math.max(last.high ?? last.price, f.price), low: Math.min(last.low ?? last.price, f.price) };
    } else {
      const open = last?.price ?? f.price;
      out.push({ t, price: f.price, open, high: Math.max(open, f.price), low: Math.min(open, f.price) });
    }
  }
  return out;
}
