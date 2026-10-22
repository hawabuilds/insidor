/**
 * A WALLET'S CATCHES — the three numbers on a profile's stats strip, and which of its held coins
 * carry the "Early" tag. Pure: the wallet route (wallet.ts) reads the rows and the candles and
 * hands them here, so every rule below runs under `node --test` without a database or a market.
 *
 *   caught early  a held coin whose post was on For You BEFORE the coin was minted: its For You
 *                 card (public.feed_post, the list of every post that was ever on it) names the
 *                 coin as its one coin, and the card's first frame is older than the mint
 *   best catch    among those, the best multiple from the holder's entry to the coin's peak since
 *   hit rate      among those with an entry, the share whose price now is above that entry
 *
 * ★ THE ENTRY IS THE MARKET PRICE AT THE HOLDER'S FIRST BUY IN INSIDOR. Our trade record knows
 * when a buy landed (public.trade) and the market's candles know what a coin cost then, in
 * dollars. A coin bought only elsewhere has no entry we can stand behind, so it counts as caught
 * early but is left out of the best catch and the hit rate rather than given a guessed one.
 *
 * ★ THE PEAK IS A CLOSE, NOT A WICK. One trade printed at ten times the surrounding prices is a
 * candle's high, not a price anyone could have sold at; the highest close since the entry is.
 *
 * ★ NOTHING KNOWN IS A REASON, NEVER ZERO. No coin caught early is `none_caught`; caught early
 * but none bought here is `no_entry`; the market's candles could not be read is `not_read_yet`.
 * A hit rate of 0 means every coin is down, which is a claim; a missing one is not.
 *
 * What breaks if changed carelessly: "before" must stay strict and on the card's FIRST frame. A
 * card that first showed after the mint was not a catch, whatever it looks like now.
 */

export interface Candle {
  /** The bucket's start, ms. */
  readonly t: number;
  readonly c: number;
}

/** A held coin's For You sighting: the card's first frame and the coin's mint, both ms; null mint when unknown. */
export interface Sighting {
  readonly address: string;
  readonly firstShownAt: number;
  readonly mintedAt: number | null;
}

export type Measured = { readonly v: number } | { readonly v: null; readonly why: string };

/** The held coins caught early: on For You strictly before they were minted. A coin with an unknown mint is not. */
export function caughtEarly(held: readonly string[], sightings: readonly Sighting[]): readonly string[] {
  const first = new Map<string, Sighting>();
  for (const s of sightings) {
    const had = first.get(s.address);
    if (had === undefined || s.firstShownAt < had.firstShownAt) first.set(s.address, { ...s, mintedAt: s.mintedAt ?? had?.mintedAt ?? null });
  }
  return held.filter((a) => {
    const s = first.get(a);
    return s !== undefined && s.mintedAt !== null && s.firstShownAt < s.mintedAt;
  });
}

/**
 * The entry and the peak since, from candles oldest first: the close of the bucket the buy fell
 * in (or the first bucket after it), and the highest close from there on. Null when no bucket
 * covers the buy, or a price is not a positive number.
 */
export function entryAndPeak(candles: readonly Candle[], boughtAt: number, bucketMs: number): { readonly entry: number; readonly peak: number } | null {
  const from = candles.findIndex((k) => k.t + bucketMs > boughtAt);
  if (from < 0) return null;
  /* A buy older than the first bucket the market gave is not covered: its entry is unknown. */
  if (candles[from]!.t > boughtAt + bucketMs) return null;
  const entry = candles[from]!.c;
  let peak = entry;
  for (let i = from; i < candles.length; i++) if (candles[i]!.c > peak) peak = candles[i]!.c;
  return entry > 0 && Number.isFinite(entry) && Number.isFinite(peak) ? { entry, peak } : null;
}

/** One caught-early coin as the stats see it: its entry and peak (null without an entry), and its price now. */
export interface CaughtCoin {
  readonly address: string;
  readonly entry: { readonly entry: number; readonly peak: number } | null;
  /** The price now, dollars; null when unpriced. */
  readonly nowUsd: number | null;
  /** True when the market's candles could not be read for it. */
  readonly unread: boolean;
}

export interface CatchStats {
  readonly caughtEarly: Measured;
  readonly bestCatch: Measured;
  readonly hitRate: Measured;
  readonly early: readonly { readonly address: string; readonly multiple: Measured }[];
}

/** The strip's three numbers and the per-coin multiples. `known` is false when the wallet itself could not be read. */
export function catchStats(coins: readonly CaughtCoin[]): CatchStats {
  const early = coins.map((c) => ({
    address: c.address,
    multiple: c.entry !== null ? { v: c.entry.peak / c.entry.entry } : { v: null, why: c.unread ? 'not_read_yet' : 'no_entry' },
  }));
  if (coins.length === 0) return { caughtEarly: { v: 0 }, bestCatch: { v: null, why: 'none_caught' }, hitRate: { v: null, why: 'none_caught' }, early };
  const measured = coins.filter((c) => c.entry !== null);
  const why = coins.some((c) => c.unread) ? 'not_read_yet' : 'no_entry';
  const best = measured.reduce<number | null>((m, c) => Math.max(m ?? 0, c.entry!.peak / c.entry!.entry), null);
  const judged = measured.filter((c) => c.nowUsd !== null);
  const up = judged.filter((c) => c.nowUsd! > c.entry!.entry).length;
  return {
    caughtEarly: { v: coins.length },
    bestCatch: best === null ? { v: null, why } : { v: best },
    hitRate: judged.length === 0 ? { v: null, why: measured.length === 0 ? why : 'no_market' } : { v: up / judged.length },
    early,
  };
}

/** Each mint's first landed buy in Insidor, from trade rows (`kind`, `mint`, `at` ms). */
export function firstBuys(rows: readonly Record<string, unknown>[]): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const mint = typeof r['mint'] === 'string' ? r['mint'] : null;
    const at = Number(r['at']);
    if (r['kind'] !== 'buy' || mint === null || !Number.isFinite(at)) continue;
    const had = out.get(mint);
    if (had === undefined || at < had) out.set(mint, at);
  }
  return out;
}

/**
 * Held coins' For You sightings: each fyp card that names one of `$1` as its one coin, with the
 * card's first frame and the coin's mint (our asset row first, the card's own copy after).
 */
export const SIGHTINGS_SQL = `
select f.payload #>> '{coins,coin,address}' as address,
       (extract(epoch from f.first_shown_at) * 1000)::bigint as first_shown,
       coalesce((extract(epoch from a.minted_at) * 1000)::bigint, (f.payload #>> '{coins,coin,mintedAt,at}')::bigint) as minted
  from public.feed_post f
  left join public.asset a on a.asset_key = 'solana:' || (f.payload #>> '{coins,coin,address}')
 where f.feed_id = 'fyp'
   and f.withdrawn_at is null
   and f.payload #>> '{coins,kind}' in ('one', 'matched')
   and f.payload #>> '{coins,coin,address}' = any($1)`;

export function sightingsFrom(rows: readonly Record<string, unknown>[]): readonly Sighting[] {
  return rows.flatMap((r): Sighting[] => {
    const address = typeof r['address'] === 'string' ? r['address'] : null;
    const first = Number(r['first_shown']);
    const minted = r['minted'] === null || r['minted'] === undefined ? null : Number(r['minted']);
    if (address === null || !Number.isFinite(first)) return [];
    return [{ address, firstShownAt: first, mintedAt: minted !== null && Number.isFinite(minted) ? minted : null }];
  });
}
