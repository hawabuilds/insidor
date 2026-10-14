/**
 * The coin chart's data, ported from Trador's `chartLwc.ts`, `chartPlot.ts` and `chartLive.ts`:
 * candles into what the chart library draws, the latest trades folded into the newest candle,
 * and the rules for when the view may move by itself. Kept apart from PriceChart.tsx so every
 * rule here runs under a test without a browser or the library.
 *
 *   1. A HOLE STAYS A HOLE. A period nobody traded in is not in the data, and nothing here
 *      invents a price for it. On the coarser views a long silence breaks the line, squeezed
 *      to a few empty slots so a quiet day does not take the width; on 1m and 5m, where empty
 *      minutes are normal, the line stays joined.
 *   2. A BAD PRINT IS DROPPED, NOT DRAWN. A price a hundred times away from the candle it sits
 *      in is a wrong-decimal report, not a wick.
 *   3. THE VIEW MOVES ONLY WHEN THE PERSON ASKS. It fits on first load and on a new timeframe or
 *      style; a live tick or older history arriving leaves a panned view where it is.
 *
 * What breaks if changed carelessly: times. Candles and trades arrive in milliseconds; the chart
 * library counts in whole seconds. The conversion is `toUtcSeconds`, and only there.
 */

import type { Candle, MarketTimeframe, MarketTrade } from '../../shared/api/index.ts';

/** One candle as the chart reads it. `price` is the close; the rest are there when the source sent them. */
export interface ChartPoint {
  readonly t: number;
  readonly price: number;
  readonly open?: number;
  readonly high?: number;
  readonly low?: number;
}

export type ChartStyle = 'line' | 'candles';

/** Trador's six views, in the order the rail shows them. */
export const TIMEFRAMES: readonly MarketTimeframe[] = ['1m', '5m', '15m', '1h', '4h', '1D'];

const MINUTE = 60_000;
export const TIMEFRAME_MS: Record<MarketTimeframe, number> = {
  '1m': MINUTE,
  '5m': 5 * MINUTE,
  '15m': 15 * MINUTE,
  '1h': 60 * MINUTE,
  '4h': 240 * MINUTE,
  '1D': 1_440 * MINUTE,
};

/** How many periods a view is sized for; only the gap rule reads it. */
export const CHART_WINDOW_BARS = 120;
/** A silence longer than a period is drawn this many empty slots wide. */
const PLOT_GAP_COMPRESS_BARS = 3;
/** Past this ratio from its candle, a price is a bad print. */
const PRICE_OUTLIER_RATIO = 100;
/** A trade under this many dollars is an indexer's dust, not a fill. */
const MIN_FILL_USD = 1e-6;
const YOUNG_LISTING_MS = 1_440 * MINUTE;

export const chartWindowMs = (tf: MarketTimeframe): number => TIMEFRAME_MS[tf] * CHART_WINDOW_BARS;

/** Trador's first view: a coin on its curve, or under a day old, opens on 1m; anything else on 1h. */
export function defaultTimeframe(r: { readonly onCurve: boolean; readonly launchedAt: number | null; readonly now: number }): MarketTimeframe {
  if (r.onCurve) return '1m';
  if (r.launchedAt !== null && r.now - r.launchedAt >= 0 && r.now - r.launchedAt < YOUNG_LISTING_MS) return '1m';
  return '1h';
}

export const toUtcSeconds = (ms: number): number => Math.floor(ms / 1000);

/**
 * The source's candles as points, oldest first and one per time. The market source can send two
 * candles for the same minute (seen 2026-10-14); the chart library refuses that outright and the
 * whole token page fell over. Two candles at one time are one period: its first open, highest
 * high, lowest low and last close — no price is made up and none is dropped.
 */
export function pointsOf(candles: readonly Candle[]): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (const c of [...candles].sort((a, b) => a.t - b.t)) {
    const last = out[out.length - 1];
    if (last !== undefined && last.t === c.t) {
      out[out.length - 1] = { ...last, price: c.c, high: Math.max(last.high ?? last.price, c.h), low: Math.min(last.low ?? last.price, c.l) };
    } else {
      out.push({ t: c.t, price: c.c, open: c.o, high: c.h, low: c.l });
    }
  }
  return out;
}

const finitePositive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function isPlausiblePrice(price: number, reference?: number | null): boolean {
  if (!finitePositive(price)) return false;
  if (reference === null || reference === undefined || !finitePositive(reference)) return true;
  const ratio = price / reference;
  return ratio <= PRICE_OUTLIER_RATIO && ratio >= 1 / PRICE_OUTLIER_RATIO;
}

/* ── into the library's shapes ─────────────────────────────────────── */

export interface LinePoint { readonly time: number; readonly value: number }
export interface CandlePoint { readonly time: number; readonly open: number; readonly high: number; readonly low: number; readonly close: number }
export interface Whitespace { readonly time: number }

const usableLevel = (n: number | undefined, close: number): number | null => (n !== undefined && isPlausiblePrice(n, close) ? n : null);

/** A candle with every level checked against its close; a missing open is the last close. */
export function candleFromPoint(point: ChartPoint, prevClose?: number): CandlePoint {
  const close = point.price;
  const open = usableLevel(point.open, close) ?? (prevClose !== undefined && prevClose > 0 ? prevClose : close);
  const high = usableLevel(point.high, close);
  const low = usableLevel(point.low, close);
  return {
    time: toUtcSeconds(point.t),
    open,
    high: high !== null ? Math.max(high, open, close) : Math.max(open, close),
    low: low !== null ? Math.min(low, open, close) : Math.min(open, close),
    close,
  };
}

const drawable = (p: ChartPoint): boolean => Number.isFinite(p.t) && Number.isFinite(p.price) && p.price > 0;

export const toLineData = (points: readonly ChartPoint[]): LinePoint[] => points.filter(drawable).map((p) => ({ time: toUtcSeconds(p.t), value: p.price }));

export function toCandleData(points: readonly ChartPoint[]): CandlePoint[] {
  const out: CandlePoint[] = [];
  let prev: number | undefined;
  for (const p of points) {
    if (!drawable(p)) continue;
    const candle = candleFromPoint(p, prev);
    out.push(candle);
    prev = candle.close;
  }
  return out;
}

export const isWhitespace = (item: object): boolean => !('value' in item) && !('close' in item);

/**
 * A silence longer than `gapMs` gets at most `maxSlots` empty slots, one second apart after the
 * last real print — unique, ascending, and never a price — so the line breaks without the
 * silence taking its calendar width.
 */
export function withCompressedBreaks<T extends { readonly time: number }>(bars: readonly T[], realTimesMs: readonly number[], gapMs: number | undefined, maxSlots = PLOT_GAP_COMPRESS_BARS): Array<T | Whitespace> {
  const first = bars[0];
  if (first === undefined) return [];
  if (gapMs === undefined || !Number.isFinite(gapMs) || gapMs <= 0 || maxSlots <= 0) return [...bars];
  const out: Array<T | Whitespace> = [first];
  for (let i = 1; i < bars.length; i += 1) {
    const bar = bars[i] as T;
    const before = bars[i - 1] as T;
    if ((realTimesMs[i] ?? 0) - (realTimesMs[i - 1] ?? 0) > gapMs) {
      const n = Math.min(maxSlots, Math.max(0, bar.time - before.time - 1));
      for (let k = 1; k <= n; k += 1) out.push({ time: before.time + k });
    }
    out.push(bar);
  }
  return out;
}

/** How far apart two prints may be before the line breaks: never on 1m and 5m, past one and a half periods above. */
export function gapBreakMsForWindow(windowMs?: number): number | undefined {
  if (windowMs === undefined || windowMs <= 0) return undefined;
  const bucket = windowMs / CHART_WINDOW_BARS;
  if (bucket <= TIMEFRAME_MS['5m']) return Number.POSITIVE_INFINITY;
  return bucket * 1.5;
}

/* ── the view ──────────────────────────────────────────────────────── */

const RIGHT_OFFSET_BARS = 3;
const RIGHT_OFFSET_PIXELS = 24;

/** Bodies wide enough to read on a short 1m or 5m series; a floor so zooming out never draws hairlines. */
export function barSpacing(barCount: number, intraday: boolean): { readonly barSpacing: number; readonly minBarSpacing: number } {
  if (!intraday) return { barSpacing: 6, minBarSpacing: 0.5 };
  if (barCount > 0 && barCount < 30) return { barSpacing: 14, minBarSpacing: 6 };
  if (barCount < 80) return { barSpacing: 10, minBarSpacing: 4 };
  return { barSpacing: 8, minBarSpacing: 3 };
}

/** The time axis: a small empty strip after the newest candle, the left edge pinned, the right edge free so a pan left holds. */
export function timeScaleOptions(r: { readonly intraday: boolean; readonly barCount: number }) {
  return {
    rightOffset: RIGHT_OFFSET_BARS,
    rightOffsetPixels: RIGHT_OFFSET_PIXELS,
    fixLeftEdge: true,
    fixRightEdge: false,
    lockVisibleTimeRangeOnResize: false,
    ...barSpacing(r.barCount, r.intraday),
  };
}

/** First print to last; the pad after it is the axis's offset, never an extension to now. */
export function visibleTimeRange(points: readonly ChartPoint[]): { readonly from: number; readonly to: number } | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return null;
  const from = toUtcSeconds(first.t);
  const to = toUtcSeconds(last.t);
  return to < from ? null : { from, to };
}

/** True when the first candle is on screen: only then does the price axis reach down to it. */
export function launchInView(range: { readonly from: number; readonly to: number } | null): boolean {
  if (range === null) return true;
  return range.from <= 0.75 && range.to >= 0;
}

export function shouldAutoFit(r: { readonly hasFitted: boolean; readonly liveEdge: boolean; readonly prepend: boolean; readonly identityChanged: boolean }): boolean {
  if (r.liveEdge || r.prepend) return false;
  if (!r.hasFitted) return true;
  return r.identityChanged;
}

/** Older candles arrived in front; the visible window is kept rather than refitted. */
export function isHistoryPrepend(prev: readonly ChartPoint[], next: readonly ChartPoint[]): boolean {
  const lastPrev = prev[prev.length - 1];
  const lastNext = next[next.length - 1];
  if (lastPrev === undefined || lastNext === undefined || next.length <= prev.length) return false;
  return lastNext.t === lastPrev.t && (next[0]?.t ?? 0) < (prev[0]?.t ?? 0);
}

/** Only the newest candle changed, or one was added after it: drawn as an update, not a redraw. */
export function isLiveEdgeUpdate(prev: readonly ChartPoint[], next: readonly ChartPoint[]): boolean {
  const lastPrev = prev[prev.length - 1];
  const lastNext = next[next.length - 1];
  if (lastPrev === undefined || lastNext === undefined) return false;
  if (next.length < prev.length || next.length > prev.length + 1) return false;
  for (let i = 0; i < Math.min(prev.length, next.length) - 1; i += 1) {
    if (prev[i]?.t !== next[i]?.t || prev[i]?.price !== next[i]?.price) return false;
  }
  if (next.length === prev.length) return lastNext.t === lastPrev.t;
  return lastNext.t > lastPrev.t && next[next.length - 2]?.t === lastPrev.t;
}

/* ── the header ────────────────────────────────────────────────────── */

/** The move across the view, first close to latest. */
export function changePctForPoints(points: readonly ChartPoint[]): number | null {
  const first = points[0]?.price;
  const last = points[points.length - 1]?.price;
  if (points.length < 2 || first === undefined || last === undefined || first <= 0) return null;
  return Number((((last - first) / first) * 100).toFixed(2));
}

/** The move inside the candle under the finger: its open to its close, not the move since the view began. */
export function hoveredCandleChangePct(points: readonly ChartPoint[], hovered: ChartPoint): number | null {
  const i = points.findIndex((p) => p.t === hovered.t);
  const { open, close } = candleFromPoint(hovered, i > 0 ? points[i - 1]?.price : undefined);
  if (!(open > 0) || !Number.isFinite(close)) return null;
  return Number((((close - open) / open) * 100).toFixed(2));
}

/* ── live trades into the newest candle ────────────────────────────── */

const bucketStart = (t: number, bucketMs: number): number => (bucketMs > 0 && Number.isFinite(t) ? Math.floor(t / bucketMs) * bucketMs : t);

function applyFill(candle: ChartPoint, price: number): ChartPoint {
  return { ...candle, price, high: Math.max(candle.high ?? candle.price, price), low: Math.min(candle.low ?? candle.price, price) };
}

/**
 * The latest trades folded into the candles, so the line moves as the trades list does between
 * candle reads. Append only: the trades are the source's latest few, not every fill, so a period
 * with none of them proves nothing and an indexed candle is never redrawn from them.
 */
export function mergeTradesIntoChart(points: readonly ChartPoint[], trades: readonly MarketTrade[], bucketMs: number): ChartPoint[] {
  const fills = trades
    .flatMap((t) => (t.at.known && t.priceUsd.known && t.usd.known && t.usd.amount > MIN_FILL_USD && isPlausiblePrice(t.priceUsd.amount) ? [{ t: t.at.at as number, price: t.priceUsd.amount }] : []))
    .sort((a, b) => a.t - b.t);
  const out: ChartPoint[] = [...points];
  const newest = out[out.length - 1];
  if (newest === undefined || fills.length === 0) return out;
  const anchor = bucketStart(newest.t, bucketMs);
  for (const fill of fills) {
    const t = bucketStart(fill.t, bucketMs);
    if (t < anchor) continue;
    const last = out[out.length - 1] as ChartPoint;
    if (!isPlausiblePrice(fill.price, last.price)) continue;
    if (t === bucketStart(last.t, bucketMs)) out[out.length - 1] = applyFill(last, fill.price);
    else out.push({ t, price: fill.price, open: last.price, high: Math.max(last.price, fill.price), low: Math.min(last.price, fill.price) });
  }
  return out;
}
