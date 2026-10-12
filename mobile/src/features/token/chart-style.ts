/**
 * Whether the coin chart is a line or candles, remembered on this device as Trador does, so the
 * choice made on one coin holds on the next.
 *
 * A convenience only: when the browser keeps nothing (a private window, storage blocked) the
 * chart opens as a line, and nothing else depends on it.
 */

import type { ChartStyle } from './chart-data.ts';

const KEY = 'insidor.chartStyle';

export function readChartStyle(): ChartStyle {
  try {
    return localStorage.getItem(KEY) === 'candles' ? 'candles' : 'line';
  } catch {
    return 'line';
  }
}

export function writeChartStyle(style: ChartStyle): void {
  try {
    localStorage.setItem(KEY, style);
  } catch {
    /* Not kept; the chart still shows the style chosen now. */
  }
}
