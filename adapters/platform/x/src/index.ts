/**
 * The X adapter, assembled. Adding a platform is this folder plus one line in
 * adapters/platform/registry.
 *
 * Every paid call goes through `metered`, so the ledger is a record of what was
 * asked rather than an estimate of what might have been. The Budget is handed
 * in and never read from a global — the adapter reports, the meter refuses, and
 * what to give up when money runs short is a product judgement that lives in
 * core.
 */

import type { CounterSet, Item, Millis } from '@insidor/contracts';
import type { Budget, Meter, Metered } from '@insidor/contracts/ports/meter.ts';
import type { DiscoveryQuery, Discovered, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { mergeSpend, metered } from '@insidor/meter';
import type { PriceBook } from '@insidor/meter';
import { discovered } from '@insidor/vendor-kit';

import { CAPABILITIES, LOOKUP, PRICES, SEARCH, SOURCE, VENDOR } from './capabilities.ts';
import type { XClient } from './client.ts';
import { searchPage } from './discover.ts';
import { chunk, observeBatch } from './observe.ts';
import { toItem } from './to-item.ts';

export interface XAdapterDeps {
  readonly client: XClient;
  readonly meter: Meter;
  /** Injected so a recorded run replays to the same Items. Never `Date.now`. */
  readonly now: () => Millis;
  /** Defaults to this vendor's measured rates; overridable when they change. */
  readonly prices?: PriceBook;
}

export function xPlatform(deps: XAdapterDeps): PlatformAdapter {
  const prices = deps.prices ?? PRICES;
  const batchSize = CAPABILITIES.observeBatchSize ?? 1;

  return {
    id: SOURCE,
    capabilities: CAPABILITIES,

    async discover(query: DiscoveryQuery, _budget: Budget): Promise<Metered<Discovered>> {
      const at = deps.now();
      const result = await metered(
        deps.meter,
        prices,
        { vendor: VENDOR, endpoint: SEARCH, unit: 'per-item-returned', estUnits: query.limit, at },
        async () => {
          const page = await searchPage(deps.client, query, at);
          return { value: page, units: page.units };
        },
      );

      return {
        value: discovered(result.value.items, result.value.cursor, result.value.hasMore),
        spend: result.spend,
      };
    },

    async observe(
      sourceItemIds: readonly string[],
      _budget: Budget,
    ): Promise<Metered<ReadonlyMap<string, CounterSet>>> {
      const at = deps.now();
      const out = new Map<string, CounterSet>();
      const spends = [];

      for (const batch of chunk(sourceItemIds, batchSize)) {
        const result = await metered(
          deps.meter,
          prices,
          { vendor: VENDOR, endpoint: LOOKUP, unit: 'per-item-returned', estUnits: batch.length, at },
          async () => {
            const read = await observeBatch(deps.client, batch, at);
            return { value: read, units: read.units };
          },
        );
        for (const [id, counters] of result.value.counters) out.set(id, counters);
        spends.push(result.spend);
      }

      return {
        value: out,
        spend: mergeSpend(
          spends,
          { vendor: VENDOR, endpoint: LOOKUP, unit: 'per-item-returned', estUnits: sourceItemIds.length, at },
          'per-item-returned',
        ),
      };
    },

    toItem(raw: unknown, at: Millis): Item {
      return toItem(raw, at);
    },

    /**
     * The cohort this item's numbers may be compared against. Language and hour
     * of day, because both move this source's reach by more than an order of
     * magnitude. The key is a label — every threshold applied to it is core's.
     */
    baselineKey(item: Item, at: Millis): string {
      const hour = new Date(at).getUTCHours();
      return `${SOURCE}|${item.lang ?? 'und'}|h${String(hour).padStart(2, '0')}`;
    },
  };
}

export { CAPABILITIES, FIDELITY, PRICES, SOURCE, VENDOR } from './capabilities.ts';
export { httpClient } from './client.ts';
export type { XClient, XClientConfig } from './client.ts';
export { toSearchQuery } from './discover.ts';
/* The citation link. Exported from the barrel because the projector — which must
   never know a URL shape — is the caller, and it asks this package by name. */
export { postUrl } from './permalink.ts';
export { toItem, toCounters } from './to-item.ts';
