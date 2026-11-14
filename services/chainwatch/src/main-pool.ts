/**
 * WHICH POOL A COIN REALLY TRADES IN: a trade is left out of the chart and the live feed when its
 * pool is both SHALLOW (under `MAIN_POOL_SHARE` of the deepest pool the coin has traded in lately)
 * and OFF PRICE (further than `PRICE_BAND` from that pool's latest price). Either alone is not enough.
 *
 * Why (the owner, 2026-11-14, JENSEN against Dexscreener: "weird vertical lines … inaccurate"): a coin
 * can trade in more than one pool, and anyone can open one. JENSEN's real pool held 611 SOL; a second
 * pool someone seeded with 0.015 SOL and a 78% fee printed a buy every few minutes at a third of the
 * price. The candles took every pool's trades, so each of those buys drew a wick to a market cap the
 * coin never had. Across all coins on 2026-11-14 about one charted minute in twenty had a wick like
 * it. A chart site draws one pool; a dollar pool is not the coin's price.
 *
 * ★ DEPTH AND PRICE, NOT NAME. Nothing here knows which venue is "main". Depth alone was tried and
 * measured on 90 seconds of the whole relay (2026-11-14): it dropped 5,560 trades, 5,549 of them
 * within 20% of the deepest pool's price — real trades in the small concentrated-liquidity pools a
 * busy coin has many of, whose reserve says little about its depth at the price. A shallow pool at
 * the right price is harmless to the chart and its trades are real, so it stays. At graduation the
 * curve's last depth and the new pool's first are close, so neither drops out.
 *
 * ★ ONLY RECENT DEPTH COUNTS. A pool's depth is its latest trade's, forgotten after `FRESH_MS` without
 * one, so a pool drained by a rug (its liquidity removed is not a trade) stops shadowing the pool
 * the coin moved to.
 *
 * ★ UNKNOWN IS ADMITTED. A trade whose pool depth or price the relay did not give is counted, as
 * every trade was before this: a hole in what we know is never a reason to hide a real trade.
 *
 * Pools are compared only within one quote token; a trade in a quote we cannot price never reaches
 * a candle anyway (chart.ts).
 *
 * What breaks if changed carelessly: the share and the band. Too tight and a real second pool's
 * trades flicker out of the chart while arbitrage catches up; too loose and crumbs come back. The
 * launch archive takes every trade, unfiltered.
 */

/** A pool shallower than this share of the coin's deepest recent pool is not the coin's price. */
export const MAIN_POOL_SHARE = 0.05;
/** …and only when its price is further than this from the deepest pool's: past 1.25x either way. */
export const PRICE_BAND = 1.25;
/** A pool's depth is forgotten this long after its last trade. */
const FRESH_MS = 30 * 60_000;
/** How often forgotten coins are let go, counted in trades judged. */
const SWEEP_EVERY = 50_000;

export interface PoolTrade {
  readonly coin: string;
  readonly quoteMint: string;
  readonly pool: string;
  readonly poolAddress: string | null;
  /** The pool's depth in its quote token after the trade; null or absent when not known. */
  readonly poolQuote?: number | null;
  /** The coin's price in the quote token after the trade; null when not known. */
  readonly priceQuote: number | null;
  readonly atMs: number;
}

interface Seen {
  depth: number;
  price: number;
  atMs: number;
}

const known = (n: number | null | undefined): n is number => n !== null && n !== undefined && Number.isFinite(n) && n > 0;

export class MainPools {
  /** coin + quote → pool → its latest depth and price. */
  readonly #pools = new Map<string, Map<string, Seen>>();
  #judged = 0;

  /** Records the trade's pool depth and says whether the trade is in a pool the coin really trades in. */
  admit(t: PoolTrade): boolean {
    if (++this.#judged % SWEEP_EVERY === 0) this.#sweep(t.atMs);
    const depth = t.poolQuote;
    const price = t.priceQuote;
    if (!known(depth) || !known(price)) return true;
    const key = `${t.coin}|${t.quoteMint}`;
    let pools = this.#pools.get(key);
    if (pools === undefined) {
      pools = new Map();
      this.#pools.set(key, pools);
    }
    const id = t.poolAddress ?? t.pool;
    const now = pools.get(id);
    if (now === undefined || t.atMs >= now.atMs) pools.set(id, { depth, price, atMs: t.atMs });
    let deepest: Seen | null = null;
    for (const p of pools.values()) if (Math.abs(t.atMs - p.atMs) <= FRESH_MS && (deepest === null || p.depth > deepest.depth)) deepest = p;
    if (deepest === null || depth >= deepest.depth * MAIN_POOL_SHARE) return true;
    const ratio = price / deepest.price;
    return ratio <= PRICE_BAND && ratio >= 1 / PRICE_BAND;
  }

  #sweep(nowMs: number): void {
    for (const [key, pools] of this.#pools) {
      for (const [id, p] of pools) if (nowMs - p.atMs > FRESH_MS) pools.delete(id);
      if (pools.size === 0) this.#pools.delete(key);
    }
  }

  size(): number {
    return this.#pools.size;
  }
}
