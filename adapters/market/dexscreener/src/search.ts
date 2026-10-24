/**
 * Search by name or ticker, kept to launchpad coins on Solana: pairs on the pump.fun curve
 * (`pumpfun`) or its graduated pool (`pumpswap`). Pure reader plus one keyless request (two with
 * `launchpadToo`).
 *
 * The vendor's search is fuzzy and spans every chain; everything not on Solana's launchpad is
 * dropped here, so a coin of the same name on another chain never reaches a list.
 *
 * ★ ITS 30 PAIRS ARE SHARED BY EVERY CHAIN. For a common word the cap is filled by other chains'
 * pairs before a launchpad coin is reached: on 2026-10-24 "PEPE" returned no launchpad pair at
 * all, "cat" one, "MEMEWAR" 12 of the 30. The vendor also matches a word against addresses, and a
 * launchpad mint ends in "pump", so `launchpadToo` asks a second time with " pump" added: that
 * answer is nearly all launchpad pairs (PEPE 19, cat 23, MEMEWAR 30). It is fuzzier, so only its
 * pairs whose ticker or name contains the term are kept; and it misses some exact ones the plain
 * question finds (TRUMP, INK), so it adds to that answer and never replaces it. Off by default:
 * it doubles the calls, and only the Search tab asks for it (services/read main.ts).
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

/** A Solana address: searched as it is, since an address is exact and needs no second question. */
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * The plain answer, then the launchpad answer's pairs it lacks whose ticker or name contains the
 * term (see the header). Pure, so the merge is tested without the vendor.
 */
export function withLaunchpad(
  term: string,
  plain: { readonly hits: readonly CoinSearchHit[]; readonly capped: boolean },
  launchpad: { readonly hits: readonly CoinSearchHit[]; readonly capped: boolean } | null,
): { readonly hits: readonly CoinSearchHit[]; readonly capped: boolean } {
  if (launchpad === null) return plain;
  const want = term.toLowerCase();
  const seen = new Set(plain.hits.map((h) => h.marketAddress ?? h.address));
  const added = launchpad.hits.filter((h) => {
    const key = h.marketAddress ?? h.address;
    if (seen.has(key) || !`${h.ticker ?? ''} ${h.name ?? ''}`.toLowerCase().includes(want)) return false;
    seen.add(key);
    return true;
  });
  return { hits: [...plain.hits, ...added], capped: plain.capped || launchpad.capped };
}

export function dexscreenerSearch(config: { readonly baseUrl: string; readonly fetch: typeof globalThis.fetch; readonly timeoutMs: number; readonly launchpadToo?: boolean }): CoinSearch {
  async function ask(q: string) {
    let response: Response;
    try {
      response = await config.fetch(`${config.baseUrl.replace(/\/+$/, '')}/latest/dex/search?q=${encodeURIComponent(q)}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      throw new VendorUnavailable('dexscreener', SEARCH_ENDPOINT, `request failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
    if (!response.ok) throw new VendorUnavailable('dexscreener', SEARCH_ENDPOINT, `responded ${response.status}`, response.status);
    return readSearch(await response.json());
  }
  return {
    async search(term) {
      if (config.launchpadToo !== true || ADDRESS.test(term)) return ask(term);
      /* The plain answer decides whether the source is up; the second one only adds to it. */
      const [plain, launchpad] = await Promise.allSettled([ask(term), ask(`${term} pump`)]);
      if (plain.status === 'rejected') throw plain.reason;
      return withLaunchpad(term, plain.value, launchpad.status === 'fulfilled' ? launchpad.value : null);
    },
  };
}
