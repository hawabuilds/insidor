/**
 * The two outside surfaces this venue reads: its own REST list, and a generic
 * chain RPC. Nothing else. Deliberately NOT a streaming subscriber:
 *
 *   - the winnable window is post-mint with a six-day median to peak, so 30–60
 *     seconds of polling latency buys nothing;
 *   - a creation stream decodes one program's create instruction, which makes
 *     it venue-specific rather than chain-specific — the wrong thing to hang a
 *     chain abstraction on;
 *   - and it costs an always-on deployment, a paid RPC tier, reconnect logic,
 *     a durable cursor and gap backfill, permanently.
 */

import { NotImplemented } from '@insidor/vendor-kit';

export interface LaunchpadClient {
  /** Newest coins first. Carries the venue's own creation timestamp. */
  listNewCoins(input: { readonly limit: number; readonly offset: number }): Promise<readonly unknown[]>;
  /** One coin, including its current virtual reserves. */
  getCoin(address: string): Promise<unknown>;
}

export interface ChainClient {
  /**
   * Oldest signature for a mint, used to confirm the launchpad's timestamp.
   * Generic: it decodes no program and works for any address on the chain.
   */
  oldestSignatureBlockTime(address: string): Promise<number | null>;
  /** Token program flags: mint and freeze authority, transfer hooks and fees. */
  tokenAccountState(address: string): Promise<unknown>;
}

export interface SolanaVenueClientConfig {
  readonly launchpadBaseUrl: string;
  readonly rpcUrl: string;
  readonly fetch: typeof globalThis.fetch;
}

export function launchpadClient(_config: SolanaVenueClientConfig): LaunchpadClient {
  return {
    listNewCoins: async (_input) => {
      // GET {launchpadBaseUrl}/coins?sort=created_timestamp&order=DESC&limit=&offset=
      //   `created_timestamp` was present on 130 of 130 coins sampled.
      throw new NotImplemented('GET /coins?sort=created_timestamp');
    },
    getCoin: async (_address) => {
      // GET {launchpadBaseUrl}/coins/{address}
      //   Carries virtual_sol_reserves / virtual_token_reserves — the quote inputs.
      throw new NotImplemented('GET /coins/{address}');
    },
  };
}

export function chainClient(_config: SolanaVenueClientConfig): ChainClient {
  return {
    oldestSignatureBlockTime: async (_address) => {
      // POST {rpcUrl} getSignaturesForAddress [address, { limit: 1000 }]
      //   The oldest entry's blockTime matched the launchpad timestamp to the
      //   second on fresh mints. Disagreement is what makes mint time unknown.
      throw new NotImplemented('POST rpc getSignaturesForAddress');
    },
    tokenAccountState: async (_address) => {
      // POST {rpcUrl} getAccountInfo [address, { encoding: 'jsonParsed' }]
      //   Token-2022 extensions live here: transfer fee and transfer hook.
      throw new NotImplemented('POST rpc getAccountInfo');
    },
  };
}
