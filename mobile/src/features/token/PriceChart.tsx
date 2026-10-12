/**
 * A coin's price chart — Trador's PriceChart, ported: Lightweight Charts drawing a line or
 * candles, with a price axis and a time axis, a finger scrub that reports the candle under it,
 * pinch to zoom, pan left through older candles, and a double tap back to the whole view.
 *
 * Its own component because the library owns a canvas the page must not touch: the chart is
 * made once per mount and then fed, never rebuilt on a new price. The rules for what it is fed
 * and when the view may move are in chart-data.ts, where they are tested.
 *
 * ★ THE SCALE STARTS AT THE FIRST CANDLE. While the oldest candle is on screen the price axis
 * reaches down to its price, so a coin that ran up is drawn rising from where it began rather
 * than floating mid-axis. Never a price that was not printed.
 *
 * What breaks if changed carelessly: the colours are read from the theme's tokens when the chart
 * is made. The library draws on a canvas and cannot read a CSS variable itself.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';

import {
  CHART_WINDOW_BARS,
  TIMEFRAME_MS,
  gapBreakMsForWindow,
  isHistoryPrepend,
  isLiveEdgeUpdate,
  isWhitespace,
  launchInView,
  shouldAutoFit,
  timeScaleOptions,
  toCandleData,
  toLineData,
  toUtcSeconds,
  visibleTimeRange,
  withCompressedBreaks,
  type ChartPoint,
  type ChartStyle,
} from './chart-data.ts';
import { chartPrice } from './chart-format.ts';
import styles from './token.module.css';

const HEIGHT = 190;
const DOUBLE_TAP_MS = 280;

interface Colours {
  readonly up: string;
  readonly down: string;
  readonly faint: string;
  readonly hairline: string;
}

function readColours(el: HTMLElement): Colours {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { up: v('--up'), down: v('--down'), faint: v('--text-3'), hairline: v('--border') };
}

const candleOptions = (c: Colours) => ({
  upColor: c.up,
  downColor: c.down,
  borderVisible: true,
  borderUpColor: c.up,
  borderDownColor: c.down,
  wickUpColor: c.up,
  wickDownColor: c.down,
  priceLineVisible: false,
  lastValueVisible: false,
});

type Series = ISeriesApi<'Area'> | ISeriesApi<'Candlestick'>;

export function PriceChart({ points, rising, windowMs, style, emptyLabel, onScrub }: {
  points: readonly ChartPoint[];
  /** Colours the line: green when the view ended above where it began. */
  rising: boolean;
  windowMs: number;
  style: ChartStyle;
  emptyLabel: string;
  onScrub: (point: ChartPoint | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Series | null>(null);
  const pointsRef = useRef(points);
  const prevPointsRef = useRef<readonly ChartPoint[]>([]);
  const styleRef = useRef(style);
  const fittedKeyRef = useRef('');
  const lastTapRef = useRef(0);
  const onScrubRef = useRef(onScrub);
  pointsRef.current = points;
  onScrubRef.current = onScrub;

  const intraday = windowMs / CHART_WINDOW_BARS <= TIMEFRAME_MS['5m'];

  const data = useMemo(() => {
    const times = points.map((p) => p.t);
    const gapMs = gapBreakMsForWindow(windowMs);
    return style === 'candles' ? withCompressedBreaks(toCandleData(points), times, gapMs) : withCompressedBreaks(toLineData(points), times, gapMs);
  }, [points, style, windowMs]);

  const fit = useCallback(() => {
    const chart = chartRef.current;
    if (chart === null || pointsRef.current.length < 2) return;
    chart.timeScale().applyOptions(timeScaleOptions({ intraday, barCount: pointsRef.current.length }));
    const range = visibleTimeRange(pointsRef.current);
    if (range !== null) chart.timeScale().setVisibleRange({ from: range.from as UTCTimestamp, to: range.to as UTCTimestamp });
    else chart.timeScale().fitContent();
  }, [intraday]);

  /* The chart, made once per mount. */
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const c = readColours(host);
    const chart = createChart(host, {
      autoSize: true,
      height: HEIGHT,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: c.faint, fontFamily: 'inherit', attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: c.hairline, style: LineStyle.SparseDotted } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.06 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, ...timeScaleOptions({ intraday, barCount: pointsRef.current.length }) },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: c.hairline, width: 1, style: LineStyle.Solid, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      handleScroll: { vertTouchDrag: false, horzTouchDrag: true, mouseWheel: true, pressedMouseMove: true },
      handleScale: { axisPressedMouseMove: true, pinch: true, mouseWheel: true, axisDoubleClickReset: true },
      localization: { priceFormatter: chartPrice },
    });
    chartRef.current = chart;
    const onCrosshair = (param: { time?: Time }) => {
      const time = param.time;
      onScrubRef.current(typeof time === 'number' ? (pointsRef.current.find((p) => toUtcSeconds(p.t) === time) ?? null) : null);
    };
    chart.subscribeCrosshairMove(onCrosshair);
    return () => {
      chart.unsubscribeCrosshairMove(onCrosshair);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      prevPointsRef.current = [];
      fittedKeyRef.current = '';
    };
  }, []);

  /* The series: swapped on a new style, otherwise fed — a live tick as an update, so a pan holds. */
  useEffect(() => {
    const chart = chartRef.current;
    const host = hostRef.current;
    if (chart === null || host === null) return;
    const c = readColours(host);
    const lineColour = rising ? c.up : c.down;
    const floor = pointsRef.current[0]?.price;
    const autoscaleInfoProvider = (original: () => { priceRange: { minValue: number; maxValue: number } | null } | null) => {
      const res = original();
      if (res?.priceRange == null || floor === undefined || !(floor > 0) || !launchInView(chart.timeScale().getVisibleLogicalRange())) return res;
      return { ...res, priceRange: { minValue: Math.min(res.priceRange.minValue, floor), maxValue: Math.max(res.priceRange.maxValue, floor) } };
    };
    const changed = styleRef.current !== style || seriesRef.current === null;
    styleRef.current = style;
    if (changed) {
      if (seriesRef.current !== null) chart.removeSeries(seriesRef.current);
      seriesRef.current = style === 'candles'
        ? chart.addSeries(CandlestickSeries, { ...candleOptions(c), autoscaleInfoProvider })
        : chart.addSeries(AreaSeries, {
            lineColor: lineColour, topColor: `${lineColour}33`, bottomColor: 'transparent', lineWidth: 2,
            priceLineVisible: false, lastValueVisible: false, crosshairMarkerRadius: 4, autoscaleInfoProvider,
          });
      prevPointsRef.current = [];
    } else if (style === 'line') {
      seriesRef.current?.applyOptions({ lineColor: lineColour, topColor: `${lineColour}33`, autoscaleInfoProvider });
    } else {
      seriesRef.current?.applyOptions({ ...candleOptions(c), autoscaleInfoProvider });
    }
    const series = seriesRef.current;
    if (series === null || data.length === 0) return;

    const prev = prevPointsRef.current;
    const liveEdge = !changed && isLiveEdgeUpdate(prev, points);
    const prepend = !changed && isHistoryPrepend(prev, points);
    const visible = prepend ? chart.timeScale().getVisibleLogicalRange() : null;
    const key = `${style}:${windowMs}`;
    const fitNow = shouldAutoFit({ hasFitted: fittedKeyRef.current === key, liveEdge, prepend, identityChanged: fittedKeyRef.current !== '' && fittedKeyRef.current !== key });
    const last = data[data.length - 1];
    if (liveEdge && last !== undefined && !isWhitespace(last)) {
      series.update(last as never);
    } else {
      series.setData(data as never);
      if (visible !== null) {
        const added = points.length - prev.length;
        chart.timeScale().setVisibleLogicalRange({ from: visible.from + added, to: visible.to + added });
      }
    }
    prevPointsRef.current = points;
    if (fitNow) {
      fittedKeyRef.current = key;
      fit();
    }
  }, [data, fit, points, rising, style, windowMs]);

  const reset = useCallback(() => {
    fit();
    onScrubRef.current(null);
  }, [fit]);

  return (
    <div
      ref={hostRef}
      className={styles['chart']}
      style={{ height: HEIGHT }}
      onDoubleClick={reset}
      onTouchEnd={() => {
        const now = Date.now();
        if (now - lastTapRef.current < DOUBLE_TAP_MS) reset();
        lastTapRef.current = now;
      }}
    >
      {points.length < 2 ? <div className={styles['chartEmpty']}>{emptyLabel}</div> : null}
    </div>
  );
}
