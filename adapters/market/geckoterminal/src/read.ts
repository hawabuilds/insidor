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

export interface Pool {
  readonly address: string;
  /** The vendor's dex id: `pump-fun` is a launchpad curve; anything else is a listed pool. */
  readonly dex: string;
  readonly reserveUsd: number | null;
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

export function readPools(raw: unknown): readonly Pool[] {
  return arr(rec(raw).data).flatMap((p) => {
    const a = rec(rec(p).attributes);
    const address = str(a.address);
    const dex = str(rec(rec(rec(rec(p).relationships).dex).data).id);
    return address === null || dex === null ? [] : [{ address, dex, reserveUsd: num(a.reserve_in_usd) }];
  });
}

/**
 * The pool a coin trades in now: the deepest listed pool; or, for a coin no listed pool holds
 * yet, its launchpad curve. A curve's reported reserve is not comparable with a pool's, so a
 * curve is chosen only when nothing else exists.
 */
export function primaryPool(pools: readonly Pool[]): Pool | null {
  const listed = pools.filter((p) => p.dex !== 'pump-fun').sort((a, b) => (b.reserveUsd ?? 0) - (a.reserveUsd ?? 0));
  return listed[0] ?? pools.find((p) => p.dex === 'pump-fun') ?? null;
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
