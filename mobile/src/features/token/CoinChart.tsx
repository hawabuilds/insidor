/**
 * A coin's price block, as Trador's asset page has it: the price and its move, the market cap
 * at that price, the chart, and under it the timeframe rail and the line or candles switch.
 * Shared by the token page and a searched coin's page, so the two cannot draw one coin two ways.
 *
 * ★ THE HEADER FOLLOWS THE FINGER. While scrubbing, the price is the candle under it, the move is
 * that candle's own open to close, and the label is its time; otherwise the price is the latest
 * (the newest trade folded into the newest candle) and the move is across the view, labelled with
 * the timeframe. The market cap is read at the shown price. With no candles, the coin's own price
 * and 24-hour change show, labelled 24H.
 *
 * What breaks if changed carelessly: the market cap is scaled from the LATEST price, the one the
 * cap was read at. Scaling from the first candle's would show a cap the coin never had. And
 * 'loading' is a placeholder the size of the number, in its place: never "$0", never empty.
 */

import { Suspense, useMemo, useState } from 'react';

import type { CoinMarket } from '../../shared/api/index.ts';
import type { Measured } from '../../shared/format/measure.ts';
import { compactMoney, formatChangePercent, formatPrice, formatUsd } from '../../shared/format/number.ts';
import { value, type Rendered } from '../../shared/format/rendered.ts';
import { CandleIcon, LineChartIcon } from '../../shared/ui/icons.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { CHART_WINDOW_BARS, candleFromPoint, changePctForPoints, hoveredCandleChangePct, mergeTradesIntoChart, pointsOf, type ChartPoint, type ChartStyle } from './chart-data.ts';
import { VIEWS, fetchTimeframe, periodMs, tradesToCandles, viewLabel, type ChartView } from './chart-view.ts';
import { chartNote, clock, movePercent } from './chart-format.ts';
import { readChartStyle, writeChartStyle } from './chart-style.ts';
import { PRICE_CHART } from '../../shared/preload.ts';
import styles from './token.module.css';

/* ★ THE CHART LIBRARY LOADS WITH THE FIRST CHART, NOT WITH THE APP (shared/preload.ts fetches it
   ahead once the app is quiet). Until it is here the chart's own frame stands in, the same size and
   saying the same empty line, so nothing moves when the lines draw in. */
const PriceChart = PRICE_CHART.Component;
/** PriceChart's own height (PriceChart.tsx HEIGHT). */
const CHART_HEIGHT = 200;

/** "17.2x" under a hundred, "240x" above; under one, "0.4x". */
export const multipleText = (m: number): string => `${m >= 100 ? Math.round(m) : m.toFixed(1)}x`;

export function CoinChart({ market, state, view, onView, ageMs, notified, price, change24h, cap, liquidity }: {
  market: CoinMarket | null;
  state: 'loading' | 'ready' | 'failed';
  view: ChartView;
  onView: (view: ChartView) => void;
  /** How long ago the coin launched; null when unknown. Picks All's candle size (chart-view.ts). */
  ageMs: number | null;
  /** When we first pushed this coin to phones, and the market cap the push carried: our bubble goes there. Null: none. */
  notified: { readonly at: number; readonly marketCapUsd: number | null } | null;
  /** The coin's own price and 24-hour change, shown when there are no candles to read. */
  price: Measured;
  change24h: Measured;
  /** 'loading' until anything has been read: a placeholder holds the number's place. */
  cap: Measured | 'loading';
  /** Null where the page does not show liquidity; 'loading' while it is being read. */
  liquidity: Measured | 'loading' | null;
}) {
  const [style, setStyle] = useState<ChartStyle>(readChartStyle);
  const [scrubbed, setScrubbed] = useState<ChartPoint | null>(null);
  /* ★ THE BUBBLE TAPPED (the owner, 2026-10-27, option C): the header says when we alerted and the
     multiple since; nothing is drawn over the chart. Touching the chart or the bubble again ends it. */
  const [alerted, setAlerted] = useState(false);
  const scrub = (p: ChartPoint | null) => {
    if (p !== null) setAlerted(false);
    setScrubbed(p);
  };
  const read = market?.kind === 'read' ? market : null;

  const period = periodMs(view, ageMs);
  const tf = fetchTimeframe(view, ageMs);
  /* 1s is built from the trades alone; every other view is the source's candles with the newest trades folded in. */
  const points = useMemo(
    () => (view === '1s' ? tradesToCandles(read?.trades ?? [], period) : mergeTradesIntoChart(pointsOf(read?.candles ?? []), read?.trades ?? [], period)),
    [read, view, period],
  );
  const latest = points[points.length - 1]?.price ?? null;
  const windowMove = changePctForPoints(points);
  const rising = (windowMove ?? 0) >= 0;

  const shown: number | null = scrubbed?.price ?? latest;
  const shownPrice: Rendered = formatPrice(shown !== null ? { known: true, amount: shown } : price);
  const move = scrubbed !== null ? hoveredCandleChangePct(points, scrubbed) : windowMove;
  const fallback = formatChangePercent(change24h);
  const direction = move !== null ? (move > 0 ? 'up' : move < 0 ? 'down' : 'flat') : fallback.direction;
  const moveText: Rendered = move !== null ? value(movePercent(move)) : fallback.text;
  const label = scrubbed !== null ? clock(scrubbed.t) : move !== null ? viewLabel(view) : '24H';
  /* ★ THE AXIS IN MARKET CAP (the owner, 2026-10-27): every price times the supply the cap was read at
     (cap over the latest price). Unknown cap: the axis stays in price, never a guessed supply. */
  const supply = cap !== 'loading' && cap.known && latest !== null && latest > 0 ? cap.amount / latest : null;
  /* The cap now against the cap our push carried: "17.2x since". Unknown either side: no multiple. */
  const sinceMultiple = notified?.marketCapUsd != null && notified.marketCapUsd > 0 && cap !== 'loading' && cap.known ? cap.amount / notified.marketCapUsd : null;
  const ohlc = scrubbed !== null && supply !== null ? candleFromPoint(scrubbed, points[points.findIndex((p) => p.t === scrubbed.t) - 1]?.price) : null;
  const shownCap: Measured | 'loading' = cap !== 'loading' && cap.known && shown !== null && latest !== null && latest > 0 ? { known: true, amount: cap.amount * (shown / latest) } : cap;

  const pick = (next: ChartStyle) => {
    setStyle(next);
    writeChartStyle(next);
  };

  return (
    <>
      <div className={styles['priceRow']}>
        {alerted && notified !== null ? (
          <div>
            <div className={styles['alertedLine']}>
              <span className={styles['alertedDot']} aria-hidden="true" />
              Alerted {clock(notified.at)}{notified.marketCapUsd !== null ? ` at $${compactMoney(notified.marketCapUsd)}` : ''}
            </div>
            {sinceMultiple !== null ? (
              <span className={`${styles['change']} ${sinceMultiple >= 1 ? styles['up'] : styles['down']}`}>
                {sinceMultiple >= 1 ? '▲ ' : '▼ '}
                {multipleText(sinceMultiple)} since
              </span>
            ) : null}
          </div>
        ) : (
        <div>
          <Value r={shownPrice} className={styles['price']} />
          <span className={`${styles['change']} ${direction === 'up' ? styles['up'] : direction === 'down' ? styles['down'] : ''}`}>
            {direction === 'up' ? '▲ ' : direction === 'down' ? '▼ ' : ''}
            <Value r={moveText} /> <span className={styles['tf']}>{label}</span>
          </span>
        </div>
        )}
        <div className={styles['cap']}>
          <span className={styles['kicker']}>Market cap</span>
          {shownCap === 'loading' ? <span className={styles['capN']} aria-label="reading"><span className={styles['capWait']} /></span> : <Value r={formatUsd(shownCap)} className={styles['capN']} />}
          {liquidity !== null ? <span className={styles['liq']}>Liq {liquidity === 'loading' ? <span className={styles['liqWait']} aria-label="reading" /> : <Value r={formatUsd(liquidity)} />}</span> : null}
        </div>
      </div>

      {/* While the finger is on a candle: its open, high, low and close, in market cap. */}
      <div className={styles['ohlc']} aria-live="polite">
        {ohlc !== null && supply !== null ? (
          <>O <b>{compactMoney(ohlc.open * supply)}</b> H <b>{compactMoney(ohlc.high * supply)}</b> L <b>{compactMoney(ohlc.low * supply)}</b> C <b>{compactMoney(ohlc.close * supply)}</b></>
        ) : null}
      </div>

      <Suspense
        fallback={
          <div className={styles['chart']} style={{ height: CHART_HEIGHT }}>
            {points.length < 2 ? <div className={styles['chartEmpty']}>{chartNote(state, market, tf)}</div> : null}
          </div>
        }
      >
        <PriceChart points={points} rising={rising} windowMs={period * CHART_WINDOW_BARS} wholeLife={view === 'all'} scale={supply} notified={notified} style={style} emptyLabel={chartNote(state, market, tf)} onScrub={scrub} onNotifiedTap={() => setAlerted((a) => !a)} />
      </Suspense>

      <div className={styles['tfRow']}>
        <div className={styles['tfs']} role="group" aria-label="Chart timeframe">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={v === view}
              className={`${styles['tfButton']} ${v === view ? (rising ? styles['tfOn'] : styles['tfOnDown']) : ''}`}
              onClick={() => {
                setScrubbed(null);
                setAlerted(false);
                onView(v);
              }}
            >
              {viewLabel(v)}
            </button>
          ))}
        </div>
        <div className={styles['kinds']}>
          <button type="button" className={style === 'line' ? styles['kindOn'] : ''} aria-label="Line chart" aria-pressed={style === 'line'} onClick={() => pick('line')}><LineChartIcon size={16} /></button>
          <button type="button" className={style === 'candles' ? styles['kindOn'] : ''} aria-label="Candle chart" aria-pressed={style === 'candles'} onClick={() => pick('candles')}><CandleIcon size={16} /></button>
        </div>
      </div>
    </>
  );
}
