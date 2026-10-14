/**
 * WHAT A PUSH SAYS ABOUT A COIN: its ticker and name, its logo, when it was made, its market cap
 * and its 24-hour move — read when the alert is made, so the push says what was true then.
 *
 *   ticker, name, logo, made   public.asset (the mint stream's own row; the logo only as https)
 *   market cap, 24h move       the market source's quote (free, one call per pass for every coin
 *                              in it), else the last cap we stored (public.market_reading, 0078)
 *
 * ★ A NUMBER WE DO NOT HAVE IS ABSENT, NEVER 0. A coin made a minute ago is usually not listed by
 * the market source yet: its cap is null and the sentence leaves it out (text.ts). A failed quote
 * is the same null, and the push still goes — an outage is not a reason to hold an alert.
 *
 * Its own file because the For You checks (pipeline.ts) and the watch (watch.ts) say the same
 * things about a coin and must read them the same way.
 */

import type { Db } from './deliver.ts';

export interface Quote {
  readonly marketCapUsd: number | null;
  readonly change: { readonly h24: number | null };
}
/** The market source, as main.ts wires it; absent in tests and when it is not wired. */
export type Quotes = (mints: readonly string[]) => Promise<ReadonlyMap<string, Quote>>;

export interface CoinFacts {
  readonly symbol: string | null;
  readonly name: string | null;
  readonly logo: string | null;
  readonly mintedAtMs: number | null;
  readonly mcUsd: number | null;
  readonly change24h: number | null;
}

const https = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/\S+$/.test(v) && v.length <= 2_000 ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

export async function coinFacts(db: Db, quotes: Quotes | undefined, addresses: readonly string[]): Promise<Map<string, CoinFacts>> {
  const list = [...new Set(addresses)];
  const out = new Map<string, CoinFacts>();
  if (list.length === 0) return out;
  const assets = await db.query<{ address: string; symbol: string | null; name: string | null; image: string | null; minted: string | null }>(
    `select address, symbol, name, image_uri as image, minted_at as minted from public.asset where chain = 'solana' and address = any($1::text[])`,
    [list],
  );
  const byAddress = new Map(assets.map((a) => [a.address, a]));
  let quoted: ReadonlyMap<string, Quote> = new Map();
  if (quotes !== undefined) {
    try {
      quoted = await quotes(list);
    } catch {
      quoted = new Map();
    }
  }
  /* The last cap we stored, for a coin the market source did not answer for (0078's grant; none before it). */
  const stored = new Map<string, number>();
  const missing = list.filter((a) => num(quoted.get(a)?.marketCapUsd) === null);
  if (missing.length > 0) {
    try {
      const rows = await db.query<{ address: string; cap: number | string | null }>(
        `select distinct on (address) address, market_cap_usd as cap from public.market_reading
          where chain = 'solana' and address = any($1::text[]) and market_cap_usd is not null and taken_at > now() - interval '1 hour'
          order by address, taken_at desc`,
        [missing],
      );
      for (const r of rows) {
        const cap = num(r.cap);
        if (cap !== null) stored.set(r.address, cap);
      }
    } catch (e) {
      if ((e as { code?: unknown }).code !== '42501') throw e;
    }
  }
  for (const address of list) {
    const a = byAddress.get(address);
    const q = quoted.get(address);
    out.set(address, {
      symbol: a?.symbol ?? null,
      name: a?.name ?? null,
      logo: https(a?.image),
      mintedAtMs: a?.minted === null || a?.minted === undefined ? null : new Date(a.minted).getTime(),
      mcUsd: num(q?.marketCapUsd) ?? stored.get(address) ?? null,
      change24h: num(q?.change.h24),
    });
  }
  return out;
}
