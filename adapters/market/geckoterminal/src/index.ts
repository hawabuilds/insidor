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
 * ★ AND IT STAYS UNDER THE LIMIT RATHER THAN FINDING IT. At most `CALLS_PER_MINUTE` requests go
 * out in any minute; past that, a kept answer is served however old, and with none kept the
 * part is unread. Candles and trades are read separately, so a refusal of one never costs the
 * other.
 *
 * What breaks if changed carelessly: `token=<mint>` on the candle request. It tells the vendor
 * which side of the pool to price, so a pool listed as SOL/COIN is never read inverted.
 */

import { VendorUnavailable } from '@insidor/vendor-kit';

import type { CoinSearch } from '@insidor/contracts/ports/coin-search.ts';

import { aggregate, primaryPool, readCandles, readPools, readTrades, type Candle, type Pool, type Trade } from './read.ts';
import { readSearch, SEARCH_PAGE } from './search.ts';

export { aggregate, primaryPool, readCandles, readPools, readTrades } from './read.ts';
export { readSearch, SEARCH_PAGE } from './search.ts';
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
/**
 * Requests a minute, by plan: under the free API's limit for one address, with room for the
 * pool lookups; the same under a demo key (whose limit is the free one's); and well under a
 * paid key's.
 */
const CALLS_PER_MINUTE: Record<GeckoPlan, number> = { free: 25, demo: 25, pro: 250 };
const MINUTE_MS = 60_000;

/**
 * The free API needs no key. With a CoinGecko key the same paths are asked of its on-chain API
 * instead — a demo key at the public host, a paid one at the pro host — with the key in a header.
 */
export type GeckoPlan = 'free' | 'demo' | 'pro';

export const BASE_URLS: Record<GeckoPlan, string> = {
  free: 'https://api.geckoterminal.com/api/v2',
  demo: 'https://api.coingecko.com/api/v3/onchain',
  pro: 'https://pro-api.coingecko.com/api/v3/onchain',
};

const KEY_HEADER: Record<Exclude<GeckoPlan, 'free'>, string> = { demo: 'x-cg-demo-api-key', pro: 'x-cg-pro-api-key' };

export interface GeckoConfig {
  readonly plan?: GeckoPlan;
  /** Required for `demo` and `pro`; never sent on `free`. */
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs: number;
  readonly now: () => number;
}

export interface CoinMarket {
  readonly pool: Pool | null;
  /** Null when they could not be read — never an empty list, which means no trades yet. */
  readonly candles: readonly Candle[] | null;
  readonly trades: readonly Trade[] | null;
}

export interface MarketData extends CoinSearch {
  /** The coin's primary pool, its candles for one view, and its latest trades. */
  coin(mint: string, timeframe: Timeframe): Promise<CoinMarket>;
}

/** A search answer is kept a minute: the same name typed twice costs one request. */
const SEARCH_KEEP_MS = 60_000;

export function geckoterminal(config: GeckoConfig): MarketData {
  const plan: GeckoPlan = config.plan !== undefined && config.plan !== 'free' && (config.apiKey ?? '') !== '' ? config.plan : 'free';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (plan !== 'free') headers[KEY_HEADER[plan]] = config.apiKey ?? '';
  const kept = new Map<string, { at: number; value: unknown; pending?: Promise<unknown> }>();
  const sent: number[] = [];

  /** Whether one more request fits in this minute; if it does, it is counted. */
  function admit(): boolean {
    const now = config.now();
    while (sent.length > 0 && now - (sent[0] ?? 0) >= MINUTE_MS) sent.shift();
    if (sent.length >= CALLS_PER_MINUTE[plan]) return false;
    sent.push(now);
    return true;
  }

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
    if (!admit()) throw new VendorUnavailable(VENDOR, path.split('?')[0] ?? path, 'held back: this minute\'s requests are spent');
    let response: Response;
    try {
      response = await config.fetch(`${config.baseUrl.replace(/\/+$/, '')}${path}`, { headers, signal: AbortSignal.timeout(config.timeoutMs) });
    } catch (error) {
      throw new VendorUnavailable(VENDOR, path.split('?')[0] ?? path, `request failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
    if (!response.ok) throw new VendorUnavailable(VENDOR, path.split('?')[0] ?? path, `responded ${response.status}`, response.status);
    return response.json();
  }

  return {
    async search(term) {
      const key = term.trim().toLowerCase();
      const hits = await cached(`search:${key}`, SEARCH_KEEP_MS, async () =>
        readSearch(await get(`/search/pools?query=${encodeURIComponent(key)}&network=solana&page=1`)),
      );
      return { hits, capped: hits.length >= SEARCH_PAGE };
    },

    async coin(mint, timeframe) {
      const pool = await cached(`pool:${mint}`, POOL_KEEP_MS, async () => primaryPool(readPools(await get(`/networks/solana/tokens/${mint}/pools?page=1`))));
      if (pool === null) return { pool: null, candles: [], trades: [] };
      const spec = CANDLES[timeframe];
      const part = <T>(read: Promise<T>): Promise<T | null> => read.catch(() => null);
      const [candles, trades] = await Promise.all([
        part(
        cached(`candles:${pool.address}:${timeframe}`, spec.keepMs, async () => {
          const raw = await get(`/networks/solana/pools/${pool.address}/ohlcv/${spec.unit}?aggregate=${spec.aggregate}&limit=${CANDLE_LIMIT}&token=${mint}&currency=usd`);
          const rows = readCandles(raw);
          return spec.mergeMs === null ? rows : aggregate(rows, spec.mergeMs);
        })),
        part(cached(`trades:${pool.address}`, TRADES_KEEP_MS, async () => readTrades(await get(`/networks/solana/pools/${pool.address}/trades`), mint))),
      ]);
      return { pool, candles, trades };
    },
  };
}
