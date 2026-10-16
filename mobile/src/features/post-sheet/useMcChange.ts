/**
 * The fact line's market cap move for one coin at the chart's interval (mc-change.ts holds the
 * rule): one market read per coin and interval while the screen is open, none without a coin.
 * Null while reading, on a failed read and whenever the rule says not to say it.
 */

import { useEffect, useState } from 'react';

import { fetchCoinMarket } from '../../shared/api/index.ts';
import type { GainInterval } from './gain-chart.ts';
import { TIMEFRAME_FOR, mcChange } from './mc-change.ts';

export function useMcChange(address: string | null, interval: GainInterval): number | null {
  const [pct, setPct] = useState<number | null>(null);
  useEffect(() => {
    setPct(null);
    if (address === null) return;
    const ac = new AbortController();
    fetchCoinMarket(`solana:${address}`, TIMEFRAME_FOR[interval], ac.signal).then(
      (m) => {
        if (!ac.signal.aborted) setPct(mcChange(m, interval));
      },
      () => undefined,
    );
    return () => ac.abort();
  }, [address, interval]);
  return pct;
}
