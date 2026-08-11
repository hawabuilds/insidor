/**
 * The vendor surface: actor runs, not endpoints.
 *
 * This vendor bills per RUN, and a run returns however many items it returns.
 * That is why the meter is told `billing: 'per-run'` and `units: 1` per call —
 * counting items here would produce a plausible dollar figure computed by
 * arithmetic that means nothing.
 */

import { NotImplemented } from '@insidor/vendor-kit';

export interface RunResult {
  readonly items: readonly unknown[];
  /** The vendor's own run id, kept so a charge can be reconciled to a call. */
  readonly runId: string | null;
}

export interface TikTokClient {
  /** Hashtag / feed / account actor. No keyword search exists on this source. */
  runDiscovery(input: { readonly hashtags?: readonly string[]; readonly accounts?: readonly string[] }): Promise<RunResult>;
  /** Re-read by URL, batched. The actor takes a list, not an id list. */
  runObserve(urls: readonly string[]): Promise<RunResult>;
}

export interface TikTokClientConfig {
  readonly token: string;
  readonly baseUrl: string;
  readonly discoveryActorId: string;
  readonly observeActorId: string;
  readonly fetch: typeof globalThis.fetch;
}

export function httpClient(_config: TikTokClientConfig): TikTokClient {
  return {
    runDiscovery: async (_input) => {
      // POST {baseUrl}/v2/acts/{discoveryActorId}/run-sync-get-dataset-items
      //   Billed per run. A run that returns nothing still costs.
      throw new NotImplemented('POST /v2/acts/{discoveryActorId}/run-sync-get-dataset-items');
    },
    runObserve: async (_urls) => {
      // POST {baseUrl}/v2/acts/{observeActorId}/run-sync-get-dataset-items
      //   Takes post URLs, not ids. Missing posts are omitted from the dataset.
      throw new NotImplemented('POST /v2/acts/{observeActorId}/run-sync-get-dataset-items');
    },
  };
}

/** The vendor addresses posts by URL; we hold ids. One place to convert. */
export const postUrl = (authorHandle: string, id: string): string =>
  `https://www.tiktok.com/@${authorHandle}/video/${id}`;
