/**
 * Search by name or ticker, kept to launchpad coins on Solana: pairs on the pump.fun curve
 * (`pumpfun`) or its graduated pool (`pumpswap`). Pure reader plus one keyless request.
 *
 * The vendor's search is fuzzy and spans every chain; everything not on Solana's launchpad is
 * dropped here, so a coin of the same name on another chain never reaches a list.
 */

import type { CoinSearch, CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';
import { arr, num, rec, str, VendorUnavailable } from '@insidor/vendor-kit';

const LAUNCHPAD: Record<string, 'curve' | 'pool'> = { pumpfun: 'curve', pumpswap: 'pool' };
const SEARCH_ENDPOINT = 'GET /latest/dex/search';
/** The vendor returns at most this many pairs; a full answer means the list was cut. */
export const SEARCH_LIMIT = 30;

export function readSearch(raw: unknown): { readonly hits: readonly CoinSearchHit[]; readonly capped: boolean } {
  const pairs = arr(rec(raw).pairs);
  const hits = pairs.flatMap((p): CoinSearchHit[] => {
    const r = rec(p);
    const venue = LAUNCHPAD[str(r.dexId) ?? ''];
    const base = rec(r.baseToken);
    const address = str(base.address);
    if (str(r.chainId) !== 'solana' || venue === undefined || address === null) return [];
    return [{
      address,
      name: str(base.name),
      ticker: str(base.symbol),
      venue,
      marketAddress: str(r.pairAddress),
      createdAt: num(r.pairCreatedAt),
      marketCapUsd: num(r.marketCap) ?? num(r.fdv),
      imageUrl: str(rec(r.info).imageUrl),
      source: 'dexscreener',
    }];
  });
  return { hits, capped: pairs.length >= SEARCH_LIMIT };
}

export function dexscreenerSearch(config: { readonly baseUrl: string; readonly fetch: typeof globalThis.fetch; readonly timeoutMs: number }): CoinSearch {
  return {
    async search(term) {
      let response: Response;
      try {
        response = await config.fetch(`${config.baseUrl.replace(/\/+$/, '')}/latest/dex/search?q=${encodeURIComponent(term)}`, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (error) {
        throw new VendorUnavailable('dexscreener', SEARCH_ENDPOINT, `request failed: ${error instanceof Error ? error.message : 'unknown'}`);
      }
      if (!response.ok) throw new VendorUnavailable('dexscreener', SEARCH_ENDPOINT, `responded ${response.status}`, response.status);
      return readSearch(await response.json());
    },
  };
}
