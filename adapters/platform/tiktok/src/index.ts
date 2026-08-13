/**
 * The TikTok adapter, assembled.
 *
 * Read `capabilities.ts` before changing anything here. The one behaviour this
 * package exists to guarantee is that no Item it produces carries a
 * reproduction counter, in any form, ever.
 */

import type { CounterSet, Item, Millis } from '@insidor/contracts';
import type { Budget, Meter, Metered } from '@insidor/contracts/ports/meter.ts';
import type { DiscoveryQuery, Discovered, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { mergeSpend, metered } from '@insidor/meter';
import type { PriceBook } from '@insidor/meter';
import { discovered, NotImplemented, rec, str } from '@insidor/vendor-kit';

import { CAPABILITIES, DISCOVER, OBSERVE, PRICES, SOURCE, VENDOR } from './capabilities.ts';
import type { TikTokClient } from './client.ts';
import { postUrl } from './client.ts';
import { toCounters, toItem } from './to-item.ts';

/**
 * Keyword search does not exist here. Returning an empty result for a keyword
 * query would read as "nothing is happening", which is the failure mode the
 * capability list exists to design out — so it is reported, not swallowed.
 */
export function toActorInput(query: DiscoveryQuery): {
  readonly hashtags?: readonly string[];
  readonly accounts?: readonly string[];
} {
  if (!CAPABILITIES.discovery.includes(query.mode)) {
    throw new NotImplemented(`tiktok:discover:${query.mode}`, 'this source has no such entry point');
  }
  const term = query.term.trim();
  if (term.length === 0) throw new NotImplemented('tiktok:discover', 'no hashtag or account to enter by');

  // This source has no server-side time cutoff — the actor returns what the feed
  // currently shows. Filtering the response here would be a lie of the worst kind:
  // it would look like a blind historical run while the selection had already been
  // made by a ranking that knows everything that happened since. Refuse instead, so
  // a replay that needs a cutoff simply cannot be built on this source.
  if (query.untilMs !== null) {
    throw new NotImplemented(
      'tiktok:discover:cutoff',
      'this source cannot bound discovery by time; a blind historical run is not available here',
    );
  }

  return query.mode === 'account' ? { accounts: [term] } : { hashtags: [term] };
}

export interface TikTokAdapterDeps {
  readonly client: TikTokClient;
  readonly meter: Meter;
  /** Injected so a recorded run replays to the same Items. Never `Date.now`. */
  readonly now: () => Millis;
  /**
   * Observation addresses posts by URL, so the caller must supply the handle
   * for each id. An absent handle is skipped rather than guessed — a wrong URL
   * costs a run and returns nothing.
   */
  readonly handleOf: (sourceItemId: string) => string | null;
  readonly prices?: PriceBook;
}

export function tiktokPlatform(deps: TikTokAdapterDeps): PlatformAdapter {
  const prices = deps.prices ?? PRICES;
  const batchSize = CAPABILITIES.observeBatchSize ?? 1;

  return {
    id: SOURCE,
    capabilities: CAPABILITIES,

    async discover(query: DiscoveryQuery, _budget: Budget): Promise<Metered<Discovered>> {
      const at = deps.now();
      const input = toActorInput(query);

      const result = await metered(
        deps.meter,
        prices,
        // One run is one unit. Counting returned items here would price a
        // per-run vendor with per-item arithmetic.
        { vendor: VENDOR, endpoint: DISCOVER, unit: 'per-run', estUnits: 1, at },
        async () => {
          const run = await deps.client.runDiscovery(input);
          return { value: run.items.slice(0, query.limit).map((raw) => toItem(raw, at)), units: 1 };
        },
      );

      // The actor has no cursor: a run returns what it returns, and it never
      // tells us whether there was more.
      return { value: discovered(result.value, null, false), spend: result.spend };
    },

    async observe(
      sourceItemIds: readonly string[],
      _budget: Budget,
    ): Promise<Metered<ReadonlyMap<string, CounterSet>>> {
      const at = deps.now();
      const out = new Map<string, CounterSet>();
      const spends = [];

      const urls: { id: string; url: string }[] = [];
      for (const id of sourceItemIds) {
        const handle = deps.handleOf(id);
        if (handle !== null) urls.push({ id, url: postUrl(handle, id) });
      }

      for (let i = 0; i < urls.length; i += batchSize) {
        const batch = urls.slice(i, i + batchSize);
        const result = await metered(
          deps.meter,
          prices,
          { vendor: VENDOR, endpoint: OBSERVE, unit: 'per-run', estUnits: 1, at },
          async () => {
            const run = await deps.client.runObserve(batch.map((b) => b.url));
            const read = new Map<string, CounterSet>();
            for (const entry of run.items) {
              const id = str(rec(entry).id) ?? str(rec(entry).awemeId);
              if (id !== null) read.set(id, toCounters(entry, at));
            }
            return { value: read, units: 1 };
          },
        );
        for (const [id, counters] of result.value) out.set(id, counters);
        spends.push(result.spend);
      }

      return {
        value: out,
        spend: mergeSpend(spends, { vendor: VENDOR, endpoint: OBSERVE, unit: 'per-run', estUnits: 1, at }, 'per-run'),
      };
    },

    toItem(raw: unknown, at: Millis): Item {
      return toItem(raw, at);
    },

    /**
     * The cohort. Reach on this source is autoplay-driven and moves with the
     * sound as much as with the poster, so the shared sound is part of what
     * makes two numbers comparable. The key is a label; the thresholds are core's.
     */
    baselineKey(item: Item, _at: Millis): string {
      const sound = item.formatIds.find((f) => f.startsWith(`${SOURCE}:sound:`)) ?? 'nosound';
      return `${SOURCE}|${item.lang ?? 'und'}|${sound}`;
    },
  };
}

export { CAPABILITIES, FIDELITY, PRICES, SOURCE, VENDOR } from './capabilities.ts';
export { httpClient, postUrl } from './client.ts';
export type { TikTokClient, TikTokClientConfig } from './client.ts';
export { toItem, toCounters, formatIds } from './to-item.ts';
