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
  TrackingModeExitMode,
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
  withCompressedBreaks,
  type ChartPoint,
  type ChartStyle,
} from './chart-data.ts';
import { chartPrice } from './chart-format.ts';
import { compactMoney } from '../../shared/format/number.ts';
import styles from './token.module.css';

const HEIGHT = 200;
/** A candle's width in px on every view but All, which fits the whole life: thin, as pump.fun's, never stretched. */
const BAR_PX = 7;
/** All's narrowest and widest candle. */
const ALL_MIN_PX = 1.5;
const ALL_MAX_PX = 7;
/** Room kept for the price axis when All works out how many candles fit. */
const AXIS_PX = 64;
const MARK_PX = 18;
/** The gap between the top of the candle's wick and the bubble's bottom. */
const MARK_LIFT_PX = 3;
/** The bubble's tap area. */
const MARK_TAP_PX = 32;
const DOUBLE_TAP_MS = 280;
/** A fomo trader's picture, and the finger-sized button around it. */
const THESIS_PX = 24;
const THESIS_TAP_PX = 34;
/** How far each further fomo trader on one candle sits above the one below it. */
const STACK_STEP_PX = 17;
/** At most this many fomo traders' pictures on one candle; the card lists the rest. */
const STACK_MAX = 3;

/** One fomo trader's thesis on the chart: their picture over the candle of the minute they posted. */
export interface ChartThesis {
  readonly id: string;
  readonly at: number;
  readonly handle: string;
  readonly pictureUrl: string | null;
}

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
  /* ★ The live value as a pill on the axis, with a dotted line across: it moves with every trade. */
  priceLineVisible: true,
  priceLineStyle: LineStyle.Dotted,
  priceLineWidth: 1 as const,
  lastValueVisible: true,
});

type Series = ISeriesApi<'Area'> | ISeriesApi<'Candlestick'>;

export function PriceChart({ points, rising, windowMs, wholeLife = false, scale = null, notified = null, onNotifiedTap, theses = [], onThesisTap, style, emptyLabel, onScrub }: {
  points: readonly ChartPoint[];
  /** All: the whole life is fitted, candles as thin as it takes. Otherwise candles keep BAR_PX and the newest sit at the right. */
  wholeLife?: boolean;
  /** The supply: every price times this is a market cap, and the axis reads in caps. Null: the axis is in price. */
  scale?: number | null;
  /** When we first pushed this coin to phones, and the market cap that push carried: our bubble sits there. */
  notified?: { readonly at: number; readonly marketCapUsd: number | null } | null;
  /** The bubble was tapped: the block above shows when the app first showed the coin and the multiple since (CoinChart). */
  onNotifiedTap?: () => void;
  /** fomo traders' theses: each trader's picture over the candle they posted on (the owner, 2026-11-06). */
  theses?: readonly ChartThesis[];
  /** A trader's picture was tapped, its centre at (`x`, `y`) px in a chart `width` px wide: the card opens beside it (CoinChart). */
  onThesisTap?: (id: string, x: number, y: number, width: number) => void;
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
  const markRef = useRef<HTMLButtonElement>(null);
  const thesisRefs = useRef(new Map<string, HTMLButtonElement>());
  const thesesRef = useRef(theses);
  thesesRef.current = theses;
  const wholeLifeRef = useRef(wholeLife);
  wholeLifeRef.current = wholeLife;
  const placeMarkRef = useRef<() => void>(() => undefined);
  const lastScrubRef = useRef<number | null>(null);
  pointsRef.current = points;
  onScrubRef.current = onScrub;

  const intraday = windowMs / CHART_WINDOW_BARS <= TIMEFRAME_MS['5m'];

  const data = useMemo(() => {
    const times = points.map((p) => p.t);
    const gapMs = gapBreakMsForWindow(windowMs);
    const k = scale !== null && scale > 0 ? scale : 1;
    const shown = k === 1 ? points : points.map((p) => ({ ...p, price: p.price * k, ...(p.open === undefined ? {} : { open: p.open * k }), ...(p.high === undefined ? {} : { high: p.high * k }), ...(p.low === undefined ? {} : { low: p.low * k }) }));
    return style === 'candles' ? withCompressedBreaks(toCandleData(shown), times, gapMs) : withCompressedBreaks(toLineData(shown), times, gapMs);
  }, [points, style, windowMs, scale]);

  /* ★ NEVER STRETCHED (the owner, 2026-10-27: "our chart is zoomed in, especially for new tokens"). The
     view no longer spreads the first candle to the last across the width, which drew eight 1m
     candles as eight blocks: candles keep their width and the newest sit at the right, the empty
     left left empty. All fits the whole life, as thin as it takes, never wider than BAR_PX. */
  const fit = useCallback(() => {
    const chart = chartRef.current;
    const host = hostRef.current;
    if (chart === null || host === null || pointsRef.current.length < 1) return;
    const n = pointsRef.current.length;
    const room = Math.max(60, host.clientWidth - AXIS_PX);
    const spacing = wholeLifeRef.current ? Math.min(ALL_MAX_PX, Math.max(ALL_MIN_PX, room / (n + 4))) : BAR_PX;
    chart.timeScale().applyOptions({ ...timeScaleOptions({ intraday, barCount: n }), barSpacing: spacing, minBarSpacing: Math.min(spacing, ALL_MIN_PX), fixLeftEdge: false, rightOffset: 4 });
    chart.timeScale().scrollToRealTime();
    placeMarkRef.current();
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
      grid: { vertLines: { color: c.hairline, style: LineStyle.SparseDotted }, horzLines: { color: c.hairline, style: LineStyle.SparseDotted } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.06 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, ...timeScaleOptions({ intraday, barCount: pointsRef.current.length }) },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: c.faint, width: 1, style: LineStyle.Solid, labelVisible: false },
        horzLine: { color: c.faint, width: 1, style: LineStyle.Dashed, labelVisible: true },
      },
      /* ★ Press and hold to read a candle; lift the finger and the chart is the chart again. A drag pans. */
      trackingMode: { exitMode: TrackingModeExitMode.OnTouchEnd },
      handleScroll: { vertTouchDrag: false, horzTouchDrag: true, mouseWheel: true, pressedMouseMove: true },
      handleScale: { axisPressedMouseMove: true, pinch: true, mouseWheel: true, axisDoubleClickReset: true },
      localization: { priceFormatter: chartPrice },
    });
    chartRef.current = chart;
    const onCrosshair = (param: { time?: Time }) => {
      const time = param.time;
      const t = typeof time === 'number' ? time : null;
      /* A light tick on each new candle under the finger, where the phone allows it (not iPhone Safari). */
      if (t !== null && lastScrubRef.current !== null && t !== lastScrubRef.current) navigator.vibrate?.(3);
      lastScrubRef.current = t;
      onScrubRef.current(t !== null ? (pointsRef.current.find((p) => toUtcSeconds(p.t) === t) ?? null) : null);
    };
    chart.subscribeCrosshairMove(onCrosshair);
    const moved = () => placeMarkRef.current();
    chart.timeScale().subscribeVisibleLogicalRangeChange(moved);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(moved);
    ro?.observe(host);
    return () => {
      ro?.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(moved);
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
    const k = scale !== null && scale > 0 ? scale : 1;
    const first = pointsRef.current[0]?.price;
    const floor = first === undefined ? undefined : first * k;
    /* The axis reads in market cap when there is a supply to read it by ("38.7K"), else in price. */
    chart.applyOptions({ localization: { priceFormatter: k === 1 ? chartPrice : (v: number) => compactMoney(v) } });
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
            priceLineVisible: true, priceLineStyle: LineStyle.Dotted, priceLineWidth: 1, lastValueVisible: true, crosshairMarkerRadius: 4, autoscaleInfoProvider,
          });
      prevPointsRef.current = [];
    } else if (style === 'line') {
      seriesRef.current?.applyOptions({ lineColor: lineColour, topColor: `${lineColour}33`, autoscaleInfoProvider });
    } else {
      seriesRef.current?.applyOptions({ ...candleOptions(c), autoscaleInfoProvider });
    }
    const series = seriesRef.current;
    /* ★ OUR MARK, AND NOTHING ELSE ON THE CHART (the owner, 2026-10-27: "just show our logo without
       words at the mc we caught it"): under the candle that holds the moment we caught the post;
       the first candle when we had it before the coin launched; none after the newest candle. */
    const placeOurs = () => {
      const img = markRef.current;
      const ch = chartRef.current;
      const ser = seriesRef.current;
      const pts = pointsRef.current;
      if (img === null) return;
      const hide = () => {
        img.style.display = 'none';
      };
      const lastPt = pts[pts.length - 1];
      const caughtAt = notified?.at ?? null;
      const firstPt = pts[0];
      /* Only where the moment is on the chart: before its first candle only All shows it, on the first candle. */
      if (ch === null || ser === null || caughtAt === null || lastPt === undefined || firstPt === undefined || caughtAt > lastPt.t + windowMs || (caughtAt < firstPt.t && !wholeLifeRef.current)) {
        hide();
        return;
      }
      let at = pts[0] as ChartPoint;
      for (const q of pts) {
        if (q.t <= caughtAt) at = q;
        else break;
      }
      const x = ch.timeScale().timeToCoordinate(toUtcSeconds(at.t) as UTCTimestamp);
      /* Just above the candle's wick, as pump.fun's bubbles sit: the candle stays readable under it. */
      const y = ser.priceToCoordinate((at.high ?? at.price) * k);
      if (x === null || y === null) {
        hide();
        return;
      }
      /* ★ WHERE WE TOLD PEOPLE, AS PUMP.FUN'S TRADER BUBBLES (the owner, 2026-10-27: "when we notified
         users of the coin"): our logo in a ringed circle just above the candle of our first push —
         no line, no words. */
      img.style.display = 'flex';
      /* The button is a finger's size around the 18px bubble; the bubble is drawn at its centre. */
      const pad = (MARK_TAP_PX - MARK_PX) / 2;
      img.style.transform = `translate(${Math.round(x - MARK_TAP_PX / 2)}px, ${Math.round(Math.max(-pad, Math.min(HEIGHT - MARK_PX - 26, y - MARK_PX - MARK_LIFT_PX) - pad))}px)`;
    };
    /* ★ FOMO'S TRADERS, AS GMGN DRAWS THEM (the owner, 2026-11-06): each thesis's trader in a small
       ringed picture just above the candle of the minute they posted, stacked upward when several
       posted on one candle, at most STACK_MAX; none before the first candle or after the newest. */
    const placeTheses = () => {
      const ch = chartRef.current;
      const ser = seriesRef.current;
      const pts = pointsRef.current;
      const firstPt = pts[0];
      const lastPt = pts[pts.length - 1];
      const onCandle = new Map<number, number>();
      for (const th of thesesRef.current) {
        const el = thesisRefs.current.get(th.id);
        if (el === undefined) continue;
        el.style.display = 'none';
        if (ch === null || ser === null || firstPt === undefined || lastPt === undefined || th.at < firstPt.t || th.at > lastPt.t + windowMs) continue;
        let at = firstPt;
        for (const q of pts) {
          if (q.t <= th.at) at = q;
          else break;
        }
        const n = onCandle.get(at.t) ?? 0;
        onCandle.set(at.t, n + 1);
        if (n >= STACK_MAX) continue;
        const x = ch.timeScale().timeToCoordinate(toUtcSeconds(at.t) as UTCTimestamp);
        const y = ser.priceToCoordinate((at.high ?? at.price) * k);
        /* Only over a candle in view: one scrolled off either side is not pinned to the edge. */
        const width = hostRef.current?.clientWidth ?? 0;
        if (x === null || y === null || x < 0 || x > width - AXIS_PX) continue;
        const pad = (THESIS_TAP_PX - THESIS_PX) / 2;
        el.style.display = 'flex';
        el.dataset['x'] = String(Math.round(x));
        el.dataset['y'] = String(Math.round(Math.max(THESIS_PX / 2, y - THESIS_PX / 2 - MARK_LIFT_PX - n * STACK_STEP_PX)));
        el.style.transform = `translate(${Math.round(x - THESIS_TAP_PX / 2)}px, ${Math.round(Math.max(-pad, Math.min(HEIGHT - THESIS_PX - 26, y - THESIS_PX - MARK_LIFT_PX - n * STACK_STEP_PX) - pad))}px)`;
      }
    };
    placeMarkRef.current = () => {
      placeTheses();
      placeOurs();
    };
    if (series === null || data.length === 0) {
      placeMarkRef.current();
      return;
    }

    /* A new view (1s to All, say) is new data, never older history arriving in front of the old view's. */
    /* The candle size the data really has: right after a switch the last view's candles are drawn while
       the new view's load, and the fit must follow the new ones when they land. */
    let step = 0;
    for (let i = 1; i < points.length; i += 1) {
      const d = (points[i]?.t ?? 0) - (points[i - 1]?.t ?? 0);
      if (d > 0 && (step === 0 || d < step)) step = d;
    }
    const key = `${style}:${windowMs}:${step}`;
    const newView = fittedKeyRef.current !== '' && fittedKeyRef.current !== key;
    const prev = newView ? [] : prevPointsRef.current;
    const liveEdge = !changed && !newView && isLiveEdgeUpdate(prev, points);
    const prepend = !changed && !newView && isHistoryPrepend(prev, points);
    const visible = prepend ? chart.timeScale().getVisibleLogicalRange() : null;
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
    placeMarkRef.current();
  }, [data, fit, points, rising, style, windowMs, scale, notified, theses]);

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
      {theses.map((th) => (
        <button
          key={th.id}
          ref={(el) => {
            if (el === null) thesisRefs.current.delete(th.id);
            else thesisRefs.current.set(th.id, el);
          }}
          type="button"
          className={styles['thesisTap']}
          aria-label={`@${th.handle} on fomo`}
          onClick={(e) => {
            e.stopPropagation();
            onThesisTap?.(th.id, Number(e.currentTarget.dataset['x'] ?? 0), Number(e.currentTarget.dataset['y'] ?? 0), hostRef.current?.clientWidth ?? 0);
          }}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          {th.pictureUrl !== null ? (
            <img className={styles['thesisPic']} src={th.pictureUrl} alt="" draggable={false} loading="lazy" />
          ) : (
            <span className={styles['thesisPic']} aria-hidden="true">{th.handle.slice(0, 1).toUpperCase()}</span>
          )}
          {/* fomo's mark on every one of its traders: where the picture comes from. */}
          <img className={styles['thesisBadge']} src="https://fomo.family/apple-touch-icon.png" alt="" draggable={false} />
        </button>
      ))}
      <button
        ref={markRef}
        type="button"
        className={styles['caughtTap']}
        aria-label="When Insidor first showed this coin"
        onClick={(e) => {
          e.stopPropagation();
          onNotifiedTap?.();
        }}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        <img className={styles['caught']} src="/icons/favicon-64.png?v=keyhole" alt="" draggable={false} />
      </button>
      {points.length < 2 ? <div className={styles['chartEmpty']}>{emptyLabel}</div> : null}
    </div>
  );
}
