/**
 * Where many coins stand, one keyless call per batch: bonded or still on the curve, and the
 * market cap now. Read for the coin universe's keep rule, which asks once about each coin that
 * has aged out of the keep-everything window.
 *
 * ★ ABSENT IS "NOT LISTED", AND ONLY FROM AN ANSWER. A coin the reply does not mention was asked
 * about and is not listed anywhere this source can see — which for a launchpad coin means nobody
 * traded it. A failed call throws, so an outage can never be mistaken for a reply that listed
 * nothing.
 */

import type { CoinStanding, CoinStandings } from '@insidor/contracts/ports/coin-search.ts';
import { arr, num, rec, str, VendorUnavailable } from '@insidor/vendor-kit';

import { MAX_ADDRESSES_PER_CALL, TOKENS_ENDPOINT } from './client.ts';
import { CURVE_DEX_IDS } from './to-market-state.ts';

/** The vendor's own limit on addresses per call. */
export const TOKENS_BATCH = MAX_ADDRESSES_PER_CALL;

export function readStandings(raw: unknown): ReadonlyMap<string, CoinStanding> {
  const out = new Map<string, { bonded: boolean; marketCapUsd: number | null; name: string | null; ticker: string | null }>();
  for (const p of arr(raw)) {
    const r = rec(p);
    const base = rec(r.baseToken);
    const address = str(base.address);
    const dex = str(r.dexId);
    if (str(r.chainId) !== 'solana' || address === null || dex === null) continue;
    const cap = num(r.marketCap) ?? num(r.fdv);
    const held = out.get(address);
    out.set(address, {
      bonded: (held?.bonded ?? false) || !CURVE_DEX_IDS.has(dex),
      marketCapUsd: held?.marketCapUsd == null ? cap : cap === null ? held.marketCapUsd : Math.max(held.marketCapUsd, cap),
      name: held?.name ?? str(base.name),
      ticker: held?.ticker ?? str(base.symbol),
    });
  }
  return out;
}

export function dexscreenerStandings(config: { readonly baseUrl: string; readonly fetch: typeof globalThis.fetch; readonly timeoutMs: number }): CoinStandings {
  return {
    batch: TOKENS_BATCH,
    async standings(addresses) {
      if (addresses.length === 0) return new Map();
      if (addresses.length > TOKENS_BATCH) throw new RangeError(`at most ${TOKENS_BATCH} addresses a call`);
      let response: Response;
      try {
        response = await config.fetch(`${config.baseUrl.replace(/\/+$/, '')}/tokens/v1/solana/${addresses.map(encodeURIComponent).join(',')}`, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (error) {
        throw new VendorUnavailable('dexscreener', TOKENS_ENDPOINT, `request failed: ${error instanceof Error ? error.message : 'unknown'}`);
      }
      if (!response.ok) throw new VendorUnavailable('dexscreener', TOKENS_ENDPOINT, `responded ${response.status}`, response.status);
      return readStandings(await response.json());
    },
  };
}

/** A coin's price now, in dollars and in SOL, and how it moved. Every number may be missing. */
export interface CoinQuote {
  readonly priceUsd: number | null;
  readonly priceSol: number | null;
  readonly marketCapUsd: number | null;
  readonly change: { readonly h1: number | null; readonly h6: number | null; readonly h24: number | null };
}

const numText = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : num(v);
  return n === null || !Number.isFinite(n) ? null : n;
};

/** One quote per coin, from its deepest pool. A coin the reply does not list is absent. */
export function readQuotes(raw: unknown): ReadonlyMap<string, CoinQuote> {
  const best = new Map<string, { liquidity: number; quote: CoinQuote }>();
  for (const p of arr(raw)) {
    const r = rec(p);
    const address = str(rec(r.baseToken).address);
    if (str(r.chainId) !== 'solana' || address === null) continue;
    const liquidity = num(rec(r.liquidity).usd) ?? -1;
    const held = best.get(address);
    if (held !== undefined && held.liquidity >= liquidity) continue;
    const change = rec(r.priceChange);
    best.set(address, {
      liquidity,
      quote: {
        priceUsd: numText(r.priceUsd),
        priceSol: numText(r.priceNative),
        marketCapUsd: num(r.marketCap) ?? num(r.fdv),
        change: { h1: num(change.h1), h6: num(change.h6), h24: num(change.h24) },
      },
    });
  }
  return new Map([...best].map(([a, b]) => [a, b.quote]));
}

/** Prices for many coins, a batch a call. Throws on an outage; never answers "no prices". */
export function dexscreenerQuotes(config: { readonly baseUrl: string; readonly fetch: typeof globalThis.fetch; readonly timeoutMs: number }) {
  return {
    batch: TOKENS_BATCH,
    async quotes(addresses: readonly string[]): Promise<ReadonlyMap<string, CoinQuote>> {
      const out = new Map<string, CoinQuote>();
      for (let i = 0; i < addresses.length; i += TOKENS_BATCH) {
        const slice = addresses.slice(i, i + TOKENS_BATCH);
        let response: Response;
        try {
          response = await config.fetch(`${config.baseUrl.replace(/\/+$/, '')}/tokens/v1/solana/${slice.map(encodeURIComponent).join(',')}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(config.timeoutMs) });
        } catch (error) {
          throw new VendorUnavailable('dexscreener', TOKENS_ENDPOINT, `request failed: ${error instanceof Error ? error.message : 'unknown'}`);
        }
        if (!response.ok) throw new VendorUnavailable('dexscreener', TOKENS_ENDPOINT, `responded ${response.status}`, response.status);
        for (const [a, q] of readQuotes(await response.json())) out.set(a, q);
      }
      return out;
    },
  };
}
