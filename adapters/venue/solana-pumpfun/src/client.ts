/**
 * The two PULL surfaces this venue reads: its own REST list, and a generic chain
 * RPC. The push surface is stream.ts and is a separate file for a separate
 * reason; this header used to argue that no such file should exist, and the
 * argument has been narrowed rather than deleted, because most of it still holds.
 *
 * WHAT IT ARGUED, AND WHAT SURVIVES. Streaming was rejected on three grounds:
 *
 *   - the winnable window is post-mint with a six-day median to peak, so 30–60
 *     seconds of polling latency buys nothing.  ★ STILL TRUE, and it is why the
 *     stream is not a latency argument. What it buys is completeness — a poll
 *     over an offset cursor cannot prove it saw the rows that appeared and
 *     scrolled past between two pages, and an unprovable window is a censored
 *     label rather than a slow one.
 *   - a creation stream decodes one program's create instruction, which makes it
 *     venue-specific rather than chain-specific.  ★ STILL TRUE, and it is why
 *     stream.ts is in this package, beside the venue it decodes, rather than in
 *     a service. Nothing above the adapter knows a create instruction exists.
 *   - it costs an always-on deployment, a paid RPC tier, reconnect logic, a
 *     durable cursor and gap backfill, permanently.  ★ THIS IS THE PART THAT
 *     CHANGED. The always-on process, the durable cursor and the coverage log
 *     were built anyway — services/chainwatch is that process, and it needs them
 *     whether it polls or listens. The paid RPC tier is not needed because the
 *     stream reads a free relay rather than decoding instructions ourselves. So
 *     the marginal cost is the reconnect logic in stream.ts and nothing else.
 *
 * The conclusion this file most protects is untouched and is enforced elsewhere:
 * a feed may never claim an exact mint time. A relayed event is second-hand, it
 * bounds the mint by its own arrival and no more, and mint-time.ts is where that
 * is decided for every path including this one.
 */

import { arr, num, rec, NotImplemented, VendorShapeError, VendorUnavailable } from '@insidor/vendor-kit';

const VENDOR_RPC = 'solana-rpc';
const OLDEST_LABEL = 'POST rpc getTransactionsForAddress';

/**
 * The block time, in seconds, of an address's oldest transaction, from one oldest-first
 * reply. Null when the address has no transactions; an RPC error is unavailable, never null.
 */
export function readOldestBlockTime(raw: unknown): number | null {
  const r = rec(raw);
  if (r.error !== undefined && r.error !== null) {
    throw new VendorUnavailable(VENDOR_RPC, OLDEST_LABEL, `rpc error: ${JSON.stringify(r.error).slice(0, 200)}`);
  }
  const first = arr(rec(r.result).data)[0];
  if (first === undefined) return null;
  const blockTime = num(rec(first).blockTime);
  if (blockTime === null) throw new VendorShapeError(VENDOR_RPC, 'result.data[0].blockTime', 'is missing');
  return blockTime;
}

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

export function chainClient(config: SolanaVenueClientConfig): ChainClient {
  return {
    /* ★ OLDEST FIRST, ONE ROW. `getSignaturesForAddress` returns newest first, so the
       oldest entry of a graduated coin is behind every trade it ever had — hundreds of
       thousands of rows, page by page. `getTransactionsForAddress` with `sortOrder: 'asc'`
       answers in one call, and is an extension only some RPC providers serve: on one that
       does not, this fails as unavailable rather than falling back to the unbounded walk.
       The oldest entry's blockTime matched the launchpad timestamp to the second on fresh
       mints; disagreement is what makes mint time unknown. */
    oldestSignatureBlockTime: async (address) => {
      let response: Response;
      try {
        response = await config.fetch(config.rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTransactionsForAddress',
            params: [address, { sortOrder: 'asc', limit: 1, transactionDetails: 'signatures' }],
          }),
        });
      } catch (error) {
        throw new VendorUnavailable(VENDOR_RPC, OLDEST_LABEL, `request failed: ${error instanceof Error ? error.message : 'unknown'}`);
      }
      if (!response.ok) throw new VendorUnavailable(VENDOR_RPC, OLDEST_LABEL, `responded ${response.status}`, response.status);
      return readOldestBlockTime(await response.json());
    },
    tokenAccountState: async (_address) => {
      // POST {rpcUrl} getAccountInfo [address, { encoding: 'jsonParsed' }]
      //   Token-2022 extensions live here: transfer fee and transfer hook.
      throw new NotImplemented('POST rpc getAccountInfo');
    },
  };
}
