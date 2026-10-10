/**
 * SAMPLE MARKET DETAIL FOR THE TOKEN PAGE — price history, recent trades, curve progress.
 *
 * ★ NONE OF THIS HAS A WIRE FIELD YET. `Coin` carries a price, a market cap, liquidity and a
 * 24-hour change; it carries no history, no trade tape and no bonding-curve progress. So these
 * panels exist only on pages that are already sample data (a sample route, or the dev
 * fixtures), under the "Sample data" bar. Against the read service the page says each one is
 * not available yet, and renders nothing that looks like a measurement.
 *
 * Deterministic: seeded from the coin id, so a screenshot is reproducible and two renders
 * agree. No transaction ids are invented — the trades have no TXN column, because a made-up
 * signature is one copy-paste from being looked up as if it were real.
 */

export type Timeframe = '1M' | '5M' | '1H' | '6H';
export const TIMEFRAMES: readonly Timeframe[] = ['1M', '5M', '1H', '6H'];

/** A small deterministic generator. Not `Math.random`, so the same coin draws the same chart. */
function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * Price points ending at `last`. The one-minute view drifts down and the rest up, so the page
 * shows both colours: green when the line ends above where it started, red when below.
 */
export function sampleSeries(coinId: string, tf: Timeframe, last: number): readonly number[] {
  const rand = seeded(`${coinId}:${tf}`);
  const points = 24;
  const drift = tf === '1M' ? -0.012 : 0.03;
  const out: number[] = [last];
  for (let i = 1; i < points; i += 1) {
    const prev = out[i - 1] ?? last;
    out.push(prev / (1 + drift + (rand() - 0.5) * 0.06));
  }
  return out.reverse();
}

export interface SampleTrade {
  readonly side: 'buy' | 'sell';
  readonly ago: string;
  readonly tokens: string;
  readonly sol: string;
  readonly usd: string;
}

export function sampleTrades(): readonly SampleTrade[] {
  return [
    { side: 'buy', ago: '12s', tokens: '1.2M', sol: '0.03 SOL', usd: '$5.16' },
    { side: 'sell', ago: '41s', tokens: '640K', sol: '0.016 SOL', usd: '$2.75' },
    { side: 'buy', ago: '1m', tokens: '4.8M', sol: '0.12 SOL', usd: '$20.60' },
    { side: 'buy', ago: '2m', tokens: '800K', sol: '0.02 SOL', usd: '$3.44' },
  ];
}

/** Bonding-curve progress, as a whole percentage. */
export function sampleCurvePercent(coinId: string): number {
  return 5 + Math.floor(seeded(coinId)() * 40);
}

/** Up, down or flat over the series — what colours the chart. */
export function directionOf(series: readonly number[]): 'up' | 'down' | 'flat' {
  const first = series[0];
  const last = series[series.length - 1];
  if (first === undefined || last === undefined || first === last) return 'flat';
  return last > first ? 'up' : 'down';
}
