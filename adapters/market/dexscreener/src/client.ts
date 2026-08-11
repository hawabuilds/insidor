/**
 * One endpoint, on purpose.
 *
 * There is a symbol-search endpoint on this vendor and it is deliberately not
 * wrapped. Two reasons, both measured:
 *
 *   - It rate-limits at around eleven sequential calls, and the code that used
 *     it ran a 250 ms delay — 240 requests a minute, straight into the ceiling.
 *   - Symbol is not a retrieval key. A search for one meme's symbol returns
 *     hundreds of tokens, and the harmful answer is not the absurd one but the
 *     plausible survivor: an established coin with a matching ticker that looks
 *     like a perfectly reasonable match and is not.
 *
 * Candidate generation is time-first and lives in a query over our own asset
 * table. Symbol is a scoring channel over that set. If a `searchBySymbol`
 * method ever appears in this file, the old bug has come back.
 */

import { NotImplemented } from '@insidor/vendor-kit';

export interface MarketClient {
  /** All pairs for one token address. The only read this vendor is used for. */
  pairsForToken(chain: string, address: string): Promise<unknown>;
  /** Up to 30 addresses per call — the batching that keeps us under the limit. */
  pairsForTokens(chain: string, addresses: readonly string[]): Promise<unknown>;
}

export interface MarketClientConfig {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
}

export const MAX_ADDRESSES_PER_CALL = 30;

export function httpClient(_config: MarketClientConfig): MarketClient {
  return {
    pairsForToken: async (_chain, _address) => {
      // GET {baseUrl}/token-pairs/v1/{chain}/{address}
      //   Returns every pair. Bonding-curve pairs carry NO liquidity object.
      throw new NotImplemented('GET /token-pairs/v1/{chain}/{address}');
    },
    pairsForTokens: async (_chain, _addresses) => {
      // GET {baseUrl}/tokens/v1/{chain}/{addresses joined by comma, max 30}
      throw new NotImplemented('GET /tokens/v1/{chain}/{addresses}');
    },
  };
}
