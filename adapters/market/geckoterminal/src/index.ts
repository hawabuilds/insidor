/**
 * GeckoTerminal, as a market data source: a coin's price history and its recent trades, free and
 * keyless — the source Trador uses for both. One coin at a time, asked when someone opens it.
 *
 * ★ ITS OWN RATE LIMIT IS THE CONSTRAINT, SO ITS ANSWERS ARE KEPT. The free API allows a few
 * dozen calls a minute for everyone sharing an address. A pool is kept two minutes, candles from
 * fifteen seconds (one-minute view) to five minutes (six-hour view), trades twelve seconds; and a
 * refresh that fails serves the last good answer rather than none. Two people opening one coin
 * cost one call.
 *
 * What breaks if changed carelessly: `token=<mint>` on the candle request. It tells the vendor
 * which side of the pool to price, so a pool listed as SOL/COIN is never read inverted.
 */

import { VendorUnavailable } from '@insidor/vendor-kit';

import { aggregate, primaryPool, readCandles, readPools, readTrades, type Candle, type Pool, type Trade } from './read.ts';

export { aggregate, primaryPool, readCandles, readPools, readTrades } from './read.ts';
export type { Candle, Pool, Trade } from './read.ts';

export const VENDOR = 'geckoterminal';
export const TIMEFRAMES = ['1m', '5m', '1h', '6h'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** The vendor's candle request for each view, and how long its answer is kept. */
const CANDLES: Record<Timeframe, { readonly unit: 'minute' | 'hour'; readonly aggregate: number; readonly mergeMs: number | null; readonly keepMs: number }> = {
  '1m': { unit: 'minute', aggregate: 1, mergeMs: null, keepMs: 15_000 },
  '5m': { unit: 'minute', aggregate: 5, mergeMs: null, keepMs: 30_000 },
  '1h': { unit: 'hour', aggregate: 1, mergeMs: null, keepMs: 60_000 },
  /* The vendor has no six-hour bucket; hourly candles are merged six at a time. */
  '6h': { unit: 'hour', aggregate: 1, mergeMs: 6 * 3_600_000, keepMs: 300_000 },
};
const POOL_KEEP_MS = 120_000;
const TRADES_KEEP_MS = 12_000;
const CANDLE_LIMIT = 300;

export interface GeckoConfig {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs: number;
  readonly now: () => number;
}

export interface CoinMarket {
  readonly pool: Pool | null;
  readonly candles: readonly Candle[];
  readonly trades: readonly Trade[];
}

export interface MarketData {
  /** The coin's primary pool, its candles for one view, and its latest trades. */
  coin(mint: string, timeframe: Timeframe): Promise<CoinMarket>;
}

export function geckoterminal(config: GeckoConfig): MarketData {
  const kept = new Map<string, { at: number; value: unknown; pending?: Promise<unknown> }>();

  /* Kept for `keepMs`; one request in flight per key; on failure, the last good answer. */
  async function cached<T>(key: string, keepMs: number, load: () => Promise<T>): Promise<T> {
    const hit = kept.get(key);
    if (hit !== undefined && config.now() - hit.at < keepMs) return hit.value as T;
    if (hit?.pending !== undefined) return hit.pending as Promise<T>;
    const pending = load();
    kept.set(key, { at: hit?.at ?? 0, value: hit?.value, pending });
    try {
      const value = await pending;
      kept.set(key, { at: config.now(), value });
      return value;
    } catch (e) {
      kept.set(key, { at: hit?.at ?? 0, value: hit?.value });
      if (hit !== undefined && hit.at > 0) return hit.value as T;
      throw e;
    }
  }

  async function get(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await config.fetch(`${config.baseUrl.replace(/\/+$/, '')}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(config.timeoutMs) });
    } catch (error) {
      throw new VendorUnavailable(VENDOR, path.split('?')[0] ?? path, `request failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
    if (!response.ok) throw new VendorUnavailable(VENDOR, path.split('?')[0] ?? path, `responded ${response.status}`, response.status);
    return response.json();
  }

  return {
    async coin(mint, timeframe) {
      const pool = await cached(`pool:${mint}`, POOL_KEEP_MS, async () => primaryPool(readPools(await get(`/networks/solana/tokens/${mint}/pools?page=1`))));
      if (pool === null) return { pool: null, candles: [], trades: [] };
      const spec = CANDLES[timeframe];
      const [candles, trades] = await Promise.all([
        cached(`candles:${pool.address}:${timeframe}`, spec.keepMs, async () => {
          const raw = await get(`/networks/solana/pools/${pool.address}/ohlcv/${spec.unit}?aggregate=${spec.aggregate}&limit=${CANDLE_LIMIT}&token=${mint}&currency=usd`);
          const rows = readCandles(raw);
          return spec.mergeMs === null ? rows : aggregate(rows, spec.mergeMs);
        }),
        cached(`trades:${pool.address}`, TRADES_KEEP_MS, async () => readTrades(await get(`/networks/solana/pools/${pool.address}/trades`), mint)),
      ]);
      return { pool, candles, trades };
    },
  };
}
