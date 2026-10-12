/**
 * The coin chart's words: the price axis labels, the time shown while scrubbing, the move the
 * header shows, and why a chart is empty. Trador's formats, on Insidor's price formatter, so the axis and the header
 * write one price the same way.
 *
 * Its own file because the chart library calls `chartPrice` for every axis label and the header
 * calls the rest; a second formatter in either place is two spellings of one number.
 */

import type { CoinMarket, MarketTimeframe } from '../../shared/api/index.ts';
import { formatPrice } from '../../shared/format/number.ts';

/** An axis label: the same digits as the price everywhere else. */
export const chartPrice = (n: number): string => formatPrice({ known: true, amount: n }).text;

/** The moment under the finger: "12 Oct, 3:45 pm". */
export function clock(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}

/** A percentage move, unsigned: the ▲ or ▼ in front carries the direction. */
export const movePercent = (pct: number): string => `${Math.abs(pct).toFixed(2)}%`;

/** Why there is no chart: still loading, the source failed, or too few candles in this view. */
export function chartNote(state: 'loading' | 'ready' | 'failed', market: CoinMarket | null, tf: MarketTimeframe): string {
  if (state === 'loading') return 'Loading price history.';
  if (state === 'failed' || market?.kind === 'unavailable' || (market?.kind === 'read' && market.candles === null)) return 'Price history could not be read just now.';
  return `Not enough history for ${tf}`;
}
