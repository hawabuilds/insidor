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
 * cap was read at. Scaling from the first candle's would show a cap the coin never had.
 */

import { useMemo, useState } from 'react';

import type { CoinMarket, MarketTimeframe } from '../../shared/api/index.ts';
import type { Measured } from '../../shared/format/measure.ts';
import { formatChangePercent, formatPrice, formatUsd } from '../../shared/format/number.ts';
import { value, type Rendered } from '../../shared/format/rendered.ts';
import { CandleIcon, LineChartIcon } from '../../shared/ui/icons.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { PriceChart } from './PriceChart.tsx';
import { TIMEFRAMES, TIMEFRAME_MS, changePctForPoints, chartWindowMs, hoveredCandleChangePct, mergeTradesIntoChart, pointsOf, type ChartPoint, type ChartStyle } from './chart-data.ts';
import { chartNote, clock, movePercent } from './chart-format.ts';
import { readChartStyle, writeChartStyle } from './chart-style.ts';
import styles from './token.module.css';

export function CoinChart({ market, state, tf, onTf, price, change24h, cap, liquidity }: {
  market: CoinMarket | null;
  state: 'loading' | 'ready' | 'failed';
  tf: MarketTimeframe;
  onTf: (tf: MarketTimeframe) => void;
  /** The coin's own price and 24-hour change, shown when there are no candles to read. */
  price: Measured;
  change24h: Measured;
  cap: Measured;
  /** Null where the page does not show liquidity. */
  liquidity: Measured | null;
}) {
  const [style, setStyle] = useState<ChartStyle>(readChartStyle);
  const [scrubbed, setScrubbed] = useState<ChartPoint | null>(null);
  const read = market?.kind === 'read' ? market : null;

  const points = useMemo(
    () => mergeTradesIntoChart(pointsOf(read?.candles ?? []), read?.trades ?? [], TIMEFRAME_MS[tf]),
    [read, tf],
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
  const label = scrubbed !== null ? clock(scrubbed.t) : move !== null ? tf : '24H';
  const shownCap: Measured = cap.known && shown !== null && latest !== null && latest > 0 ? { known: true, amount: cap.amount * (shown / latest) } : cap;

  const pick = (next: ChartStyle) => {
    setStyle(next);
    writeChartStyle(next);
  };

  return (
    <>
      <div className={styles['priceRow']}>
        <div>
          <Value r={shownPrice} className={styles['price']} />
          <span className={`${styles['change']} ${direction === 'up' ? styles['up'] : direction === 'down' ? styles['down'] : ''}`}>
            {direction === 'up' ? '▲ ' : direction === 'down' ? '▼ ' : ''}
            <Value r={moveText} /> <span className={styles['tf']}>{label}</span>
          </span>
        </div>
        <div className={styles['cap']}>
          <span className={styles['kicker']}>Market cap</span>
          <Value r={formatUsd(shownCap)} className={styles['capN']} />
          {liquidity !== null ? <span className={styles['liq']}>Liq <Value r={formatUsd(liquidity)} /></span> : null}
        </div>
      </div>

      <PriceChart points={points} rising={rising} windowMs={chartWindowMs(tf)} style={style} emptyLabel={chartNote(state, market, tf)} onScrub={setScrubbed} />

      <div className={styles['tfRow']}>
        <div className={styles['tfs']} role="group" aria-label="Chart timeframe">
          {TIMEFRAMES.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={t === tf}
              className={`${styles['tfButton']} ${t === tf ? (rising ? styles['tfOn'] : styles['tfOnDown']) : ''}`}
              onClick={() => {
                setScrubbed(null);
                onTf(t);
              }}
            >
              {t}
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
