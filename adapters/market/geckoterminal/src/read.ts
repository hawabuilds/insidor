/**
 * Reading GeckoTerminal's replies: a coin's pools, a pool's candles, a pool's trades — pure,
 * so each shape is tested against a recorded reply with no network.
 *
 * Separate from client.ts because the field names and their quirks live here and nowhere else:
 * candles arrive newest first as `[seconds, open, high, low, close, volume]`; a trade's side is
 * read from which token went where, never from the vendor's own `kind`; and a pump.fun coin's
 * curve is listed as a pool of dex `pump-fun`, whose address is the curve account itself.
 *
 * What breaks if changed carelessly: the price of a trade is the price of OUR coin in it — the
 * `to` side on a buy, the `from` side on a sell. Reading the other side would report the price
 * of SOL as the coin's.
 */

import { arr, num, rec, str } from '@insidor/vendor-kit';

/** One side of a pool, as the reply's `included` tokens name it. */
export interface PoolToken {
  readonly address: string;
  readonly symbol: string | null;
  readonly name: string | null;
  /** Https only; the vendor's "missing" placeholder is no picture. */
  readonly imageUrl: string | null;
}

export interface Pool {
  readonly address: string;
  /** The vendor's dex id: `pump-fun` is a launchpad curve; anything else is a listed pool. */
  readonly dex: string;
  /** Both sides' dollar value together, as the vendor reports it; null when it did not say. */
  readonly reserveUsd: number | null;
  /** Dollars traded in the pool over the last 24 hours, as the vendor reports it; null when it did not say. */
  readonly volume24hUsd?: number | null;
  /** The dex's own name ("PumpSwap", "Meteora"); null when the reply did not include it. */
  readonly dexName?: string | null;
  /** The pool's two sides. Null when the reply did not include that token. */
  readonly base?: PoolToken | null;
  readonly quote?: PoolToken | null;
}

export interface Candle {
  /** The bucket's start, in milliseconds. */
  readonly t: number;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
}

export interface Trade {
  /** The transaction it was in. */
  readonly tx: string;
  readonly side: 'buy' | 'sell';
  /** Our coin's amount in the trade. */
  readonly tokenAmount: number | null;
  readonly usd: number | null;
  readonly priceUsd: number | null;
  readonly at: number | null;
  readonly maker: string | null;
}

const httpsOnly = (v: string | null): string | null => (v !== null && v.startsWith('https://') ? v : null);

/**
 * A coin's pools, each with its two sides and its dex's name when the request asked for them
 * (`include=base_token,quote_token,dex`). A side the reply did not include is null, never guessed
 * from the pool's display name.
 */
export function readPools(raw: unknown): readonly Pool[] {
  const tokens = new Map<string, PoolToken>();
  const dexNames = new Map<string, string>();
  for (const i of arr(rec(raw).included)) {
    const r = rec(i);
    const id = str(r.id);
    const a = rec(r.attributes);
    if (id === null) continue;
    if (str(r.type) === 'dex') {
      const name = str(a.name);
      if (name !== null) dexNames.set(id, name);
    } else if (str(r.type) === 'token') {
      const address = str(a.address);
      if (address !== null) tokens.set(id, { address, symbol: str(a.symbol), name: str(a.name), imageUrl: httpsOnly(str(a.image_url)) });
    }
  }
  return arr(rec(raw).data).flatMap((p) => {
    const a = rec(rec(p).attributes);
    const rel = rec(rec(p).relationships);
    const address = str(a.address);
    const dex = str(rec(rec(rel.dex).data).id);
    const side = (key: string): PoolToken | null => {
      const id = str(rec(rec(rel[key]).data).id);
      return id === null ? null : (tokens.get(id) ?? null);
    };
    return address === null || dex === null
      ? []
      : [{ address, dex, reserveUsd: num(a.reserve_in_usd), volume24hUsd: num(rec(a.volume_usd).h24), dexName: dexNames.get(dex) ?? null, base: side('base_token'), quote: side('quote_token') }];
  });
}

/**
 * The token a pool pairs `mint` with: the quote side when the coin is the base, the base side when
 * the coin is the quote. Null when the reply did not include it, or the pool does not hold `mint`.
 */
export function pairedWith(pool: Pool, mint: string): PoolToken | null {
  if (pool.base?.address === mint) return pool.quote ?? null;
  if (pool.quote?.address === mint) return pool.base ?? null;
  return null;
}

/** The coin's own side of a pool, as the market lists it; null when not included. */
export function ownSide(pool: Pool, mint: string): PoolToken | null {
  if (pool.base?.address === mint) return pool.base;
  if (pool.quote?.address === mint) return pool.quote;
  return null;
}

/**
 * The pool a coin trades in now: the deepest listed pool; or, for a coin no listed pool holds
 * yet, its launchpad curve. A curve's reported reserve is not comparable with a pool's (the vendor
 * reports it as 0), so a curve is chosen over a listed pool only when it is plainly the market.
 *
 * ★ A STRAY POOL DOES NOT BEAT THE CURVE THE COIN TRADES ON (the owner, 2026-11-05: $GIF, paired
 * with OPENAI on its curve, $87K traded in a day, was charted from someone's $255 SOL pool on Hadron
 * with "Liq 252"). The curve wins when the deepest listed pool holds under `STRAY_POOL_USD` and the
 * curve traded more than it over the day. The coin's own graduation pool (PumpSwap, the same token
 * on its other side as the curve) is never stray, however thin, so a coin that left its curve today
 * and fell is still charted from its pool.
 */
const STRAY_POOL_USD = 5_000;

export function primaryPool(pools: readonly Pool[]): Pool | null {
  const listed = pools.filter((p) => p.dex !== 'pump-fun').sort((a, b) => (b.reserveUsd ?? 0) - (a.reserveUsd ?? 0));
  const curve = pools.find((p) => p.dex === 'pump-fun') ?? null;
  const deepest = listed[0] ?? null;
  if (deepest === null) return curve;
  const curveTrades = curve?.volume24hUsd ?? null;
  const others = (p: Pool): readonly (string | undefined)[] => [p.base?.address, p.quote?.address];
  const graduated = curve !== null && deepest.dex === 'pumpswap' && others(curve).every((a) => others(deepest).includes(a));
  const stray = !graduated && deepest.reserveUsd !== null && deepest.reserveUsd < STRAY_POOL_USD;
  if (curve !== null && stray && curveTrades !== null && curveTrades > (deepest.volume24hUsd ?? 0)) return curve;
  return deepest;
}

export function readCandles(raw: unknown): readonly Candle[] {
  const rows = arr(rec(rec(rec(raw).data).attributes).ohlcv_list);
  return rows
    .flatMap((row) => {
      const r = arr(row).map((v) => num(v));
      const [t, o, h, l, c] = r;
      return t == null || o == null || h == null || l == null || c == null ? [] : [{ t: t * 1_000, o, h, l, c }];
    })
    .sort((a, b) => a.t - b.t);
}

/** A candle with its dollar volume: what an older coin's trading around a post is measured from. */
export interface VolumeCandle {
  readonly t: number;
  readonly c: number;
  /** The bucket's volume in dollars (`currency=usd`); null when the row did not carry it. */
  readonly v: number | null;
}

/**
 * Candles with their volume, oldest first. Separate from `readCandles`, which drops the sixth
 * field because a chart has no use for it; here it is the point. A bucket with no trades is not
 * sent at all, so a gap between two rows is an hour nobody traded, never an unread one.
 */
export function readVolumeCandles(raw: unknown): readonly VolumeCandle[] {
  return arr(rec(rec(rec(raw).data).attributes).ohlcv_list)
    .flatMap((row) => {
      const r = arr(row).map((v) => num(v));
      const [t, , , , c, v] = r;
      return t == null || c == null ? [] : [{ t: t * 1_000, c, v: v ?? null }];
    })
    .sort((a, b) => a.t - b.t);
}

/** Merge each run of `factor` consecutive candles into one: the 6-hour view from hourly candles. */
export function aggregate(candles: readonly Candle[], bucketMs: number): readonly Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const t = Math.floor(c.t / bucketMs) * bucketMs;
    const last = out[out.length - 1];
    if (last !== undefined && last.t === t) out[out.length - 1] = { t, o: last.o, h: Math.max(last.h, c.h), l: Math.min(last.l, c.l), c: c.c };
    else out.push({ ...c, t });
  }
  return out;
}

export function readTrades(raw: unknown, mint: string): readonly Trade[] {
  return arr(rec(raw).data).flatMap((d) => {
    const a = rec(rec(d).attributes);
    const tx = str(a.tx_hash);
    if (tx === null) return [];
    const buy = str(a.to_token_address) === mint;
    const sell = str(a.from_token_address) === mint;
    if (!buy && !sell) return [];
    const at = str(a.block_timestamp);
    return [{
      tx,
      side: buy ? ('buy' as const) : ('sell' as const),
      tokenAmount: num(buy ? a.to_token_amount : a.from_token_amount),
      usd: num(a.volume_in_usd),
      priceUsd: num(buy ? a.price_to_in_usd : a.price_from_in_usd),
      at: at === null ? null : Date.parse(at),
      maker: str(a.tx_from_address),
    }];
  });
}
