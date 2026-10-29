/**
 * A TOKEN PAGE'S CHART AND TRADES FROM OUR OWN DATA (the owner, 2026-10-27: "build our own candles"),
 * so the page stops waiting seconds on the market source. The candles are the ones chainwatch builds
 * from the trade stream (0144, public.coin_candle); the latest trades are chainwatch's own memory,
 * asked over the private network (GET /trades, chainwatch chart.ts). market.ts asks this first and
 * the market source only when this says no.
 *
 * ★ WE ANSWER ONLY WHEN WE HOLD ENOUGH OF THE COIN'S LIFE FOR THE VIEW. A coin launched before we
 * recorded it (or one chainwatch first charted mid-life) has candles only from `recorded_from`; a
 * chart of it drawn from ours would begin halfway through and say the coin was born there. So ours is
 * used when the recording began at the coin's launch, or reaches back `WANT_BARS` candles of the view
 * asked for; otherwise the market source draws it. Same for the trades: chainwatch says whether its
 * list is whole, and a short list from a process that restarted a minute ago is not the coin's trades.
 *
 * ★ AND ONLY WHILE CHAINWATCH ANSWERS. Its trades are asked on every read: an answer is the proof the
 * candles are still being written. Silent (down, deploying, unreachable), the market source answers.
 *
 * ★ THE POOL IS STILL THE MARKET SOURCE'S WHEN IT HAS IT. Its pool answer (what the coin is paired
 * with, the dex by name, the liquidity) is kept for good once read, so it is waited for only
 * `POOL_WAIT_MS`; a coin it has never been asked about is named from the stream's own facts instead
 * (the pool of its latest trade and the token it is priced in) with liquidity not reported, and the
 * source's answer lands in its keep for the next read.
 *
 * What breaks if changed carelessly: the timeframes. 5m and 15m are built from minute rows and the
 * minute rows are kept a week; anything from an hour up is built from the hourly rows, kept for good.
 */

import type { Candle, Pool, PoolToken, Timeframe, Trade } from '@insidor/market-geckoterminal';
import { aggregate } from '@insidor/market-geckoterminal';

import type { Db } from './queries.ts';

/** A view is ours when the recording reaches back this many of its candles (or to launch). */
export const WANT_BARS = 300;
/** At most this many candles, as the market source serves. */
const CANDLE_LIMIT = 1_000;
/** A list of our trades this long is shown even when chainwatch has not held the coin since its launch. */
const MIN_TRADES = 50;
/** How long the market source's pool answer is waited for before the stream's facts name the pool. */
const POOL_WAIT_MS = 150;

const MINUTE = 60_000;
const HOUR = 3_600_000;
/** Each view: which rows it is built from and its candle in ms. */
const VIEWS: Record<Timeframe, { readonly rows: 1 | 60; readonly ms: number }> = {
  '1m': { rows: 1, ms: MINUTE },
  '5m': { rows: 1, ms: 5 * MINUTE },
  '15m': { rows: 1, ms: 15 * MINUTE },
  '1h': { rows: 60, ms: HOUR },
  '4h': { rows: 60, ms: 4 * HOUR },
  '6h': { rows: 60, ms: 6 * HOUR },
  '1D': { rows: 60, ms: 24 * HOUR },
};

/** The relay's pool names, as the market source's dex ids and names. */
const DEXES: Readonly<Record<string, { readonly dex: string; readonly name: string }>> = {
  pump: { dex: 'pump-fun', name: 'Pump.fun' },
  'pump-amm': { dex: 'pumpswap', name: 'PumpSwap' },
  'raydium-launchpad': { dex: 'raydium-launchlab', name: 'Raydium LaunchLab' },
  'raydium-cpmm': { dex: 'raydium-cp', name: 'Raydium CPMM' },
  'meteora-damm-v2': { dex: 'meteora-damm-v2', name: 'Meteora DAMM v2' },
  'meteora-dbc': { dex: 'meteora-dbc', name: 'Meteora DBC' },
};
const QUOTES: Readonly<Record<string, PoolToken>> = {
  So11111111111111111111111111111111111111112: { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Wrapped SOL', imageUrl: null },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', imageUrl: null },
};

export const CHART_SQL = `
select extract(epoch from c.recorded_from) * 1000 as recorded_from, c.from_launch, c.pool, c.pool_address, c.quote_mint,
       a.symbol, a.name, a.image_uri
  from public.coin_chart c
  left join public.asset a on a.chain = 'solana' and a.address = c.address
 where c.address = $1`;

export const CANDLES_SQL = `
select extract(epoch from bucket) * 1000 as t, o, h, l, c
  from public.coin_candle
 where address = $1 and minutes = $2 and bucket >= to_timestamp($3::float8 / 1000)
 order by bucket`;

/** chainwatch's answer for a coin's latest trades. */
export type HeldTrades = { readonly held: false } | { readonly held: true; readonly whole: boolean; readonly trades: readonly Trade[] };

export interface OwnMarketDeps {
  readonly db: Db;
  /** chainwatch's latest trades of a coin; throws when it does not answer. */
  readonly heldTrades: (mint: string) => Promise<HeldTrades>;
  /** The market source's pool for the coin (kept once read). */
  readonly pool: (mint: string) => Promise<Pool | null>;
  readonly now: () => number;
}

export interface OwnMarket {
  readonly pool: Pool | null;
  readonly candles: readonly Candle[];
  /** Null: ours are not enough, ask the market source for the trades. */
  readonly trades: readonly Trade[] | null;
  /**
   * When our recording of the coin began, for a chart that does not reach back to its launch; null when it
   * covers the view (`covers`). A chart drawn from a mid-life recording says where it starts, never that the
   * coin was born there (the owner, 2026-10-29: old coins' charts and trades from our own data, labelled).
   */
  readonly fromMs: number | null;
}

/** Whether our recording holds enough of the coin's life for this view. Pure. */
export function covers(r: { readonly recordedFromMs: number; readonly fromLaunch: boolean }, tf: Timeframe, nowMs: number): boolean {
  return r.fromLaunch || r.recordedFromMs <= nowMs - WANT_BARS * VIEWS[tf].ms;
}

/** A pool named from the stream's facts, for a coin the market source has not answered about yet. Pure. */
export function streamPool(mint: string, row: { readonly pool: string | null; readonly poolAddress: string | null; readonly quoteMint: string | null; readonly symbol: string | null; readonly name: string | null; readonly imageUrl: string | null }): Pool | null {
  if (row.pool === null || row.poolAddress === null) return null;
  const dex = DEXES[row.pool];
  const quote = row.quoteMint === null ? null : (QUOTES[row.quoteMint] ?? null);
  const imageUrl = row.imageUrl !== null && row.imageUrl.startsWith('https://') ? row.imageUrl : null;
  return {
    address: row.poolAddress,
    dex: dex?.dex ?? row.pool,
    dexName: dex?.name ?? null,
    reserveUsd: null,
    base: { address: mint, symbol: row.symbol, name: row.name, imageUrl },
    quote,
  };
}

const finite = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Our chart and trades for the coin, or null when the market source must answer instead. */
export async function ownMarket(mint: string, tf: Timeframe, deps: OwnMarketDeps): Promise<OwnMarket | null> {
  const now = deps.now();
  const view = VIEWS[tf];
  const since = Math.floor((now - CANDLE_LIMIT * view.ms) / view.ms) * view.ms;
  const held = deps.heldTrades(mint).catch(() => null);
  const [rows, raw] = await Promise.all([deps.db.query(CHART_SQL, [mint]), deps.db.query(CANDLES_SQL, [mint, view.rows, since])]);
  const row = rows[0];
  const recordedFromMs = finite(row?.['recorded_from']);
  if (row === undefined || recordedFromMs === null) return null;
  const covered = covers({ recordedFromMs, fromLaunch: row['from_launch'] === true }, tf, now);
  const minute: Candle[] = [];
  for (const r of raw) {
    const t = finite(r['t']);
    const o = finite(r['o']);
    const h = finite(r['h']);
    const l = finite(r['l']);
    const c = finite(r['c']);
    if (t !== null && o !== null && h !== null && l !== null && c !== null) minute.push({ t, o, h, l, c });
  }
  if (minute.length === 0) return null;
  const trades = await held;
  if (trades === null) return null;
  /* Covered, our trades stand only when they are the coin's; a mid-life chart takes whatever latest trades we hold. */
  const ownTrades = trades.held && (!covered || trades.whole || trades.trades.length >= MIN_TRADES) ? trades.trades : null;
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  const fromStream = streamPool(mint, { pool: str(row['pool']), poolAddress: str(row['pool_address']), quoteMint: str(row['quote_mint']), symbol: str(row['symbol']), name: str(row['name']), imageUrl: str(row['image_uri']) });
  const market = deps.pool(mint).catch(() => null);
  const pool = await Promise.race([market, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), POOL_WAIT_MS).unref())]);
  return {
    pool: pool ?? fromStream,
    candles: view.ms === view.rows * MINUTE ? minute : aggregate(minute, view.ms),
    trades: ownTrades,
    fromMs: covered ? null : recordedFromMs,
  };
}

/** chainwatch's GET /trades, from the live feed's address on the same private host. */
export function heldTradesFrom(liveUpstreamUrl: string | null, timeoutMs: number): ((mint: string) => Promise<HeldTrades>) | null {
  if (liveUpstreamUrl === null) return null;
  const base = new URL(liveUpstreamUrl);
  return async (mint) => {
    const url = new URL('/trades', base);
    url.searchParams.set('coin', mint);
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`chainwatch answered ${res.status}`);
    return (await res.json()) as HeldTrades;
  };
}
