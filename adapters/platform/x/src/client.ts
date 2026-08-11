/**
 * The HTTP surface, and nothing else. Two endpoints, both paid.
 *
 * Everything above this file is deterministic and testable without a network.
 * That separation is what lets the conformance suite run the whole adapter —
 * its capability claims, its translation, its fidelity — with the client
 * throwing.
 */

import { NotImplemented } from '@insidor/vendor-kit';

export interface SearchPage {
  readonly items: readonly unknown[];
  readonly cursor: string | null;
  /** From the vendor. Never inferred from whether the page looked full. */
  readonly hasMore: boolean;
}

export interface XClient {
  /** Query-syntax search. This source is the only one of ours that has it. */
  search(query: string, cursor: string | null): Promise<SearchPage>;
  /** Re-read by id, up to `capabilities.observeBatchSize` per call. */
  lookup(ids: readonly string[]): Promise<readonly unknown[]>;
}

export interface XClientConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  /** Injected so the conformance suite never needs a real one. */
  readonly fetch: typeof globalThis.fetch;
}

export function httpClient(_config: XClientConfig): XClient {
  return {
    search: async (_query, _cursor) => {
      // GET {baseUrl}/twitter/tweet/advanced_search?query=&cursor=
      //   header: X-API-Key. Paged by opaque cursor; billed per tweet returned.
      throw new NotImplemented('GET /twitter/tweet/advanced_search');
    },
    lookup: async (_ids) => {
      // GET {baseUrl}/twitter/tweets?tweet_ids=<comma separated, <= 100>
      //   Missing ids come back omitted, not as errors — a deleted item and a
      //   wrong id look the same, so absence must never be read as zero.
      throw new NotImplemented('GET /twitter/tweets');
    },
  };
}
