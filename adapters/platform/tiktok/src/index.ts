/**
 * The TikTok adapter, assembled.
 *
 * Read `capabilities.ts` before changing anything here. The one behaviour this
 * package exists to guarantee is that no Item it produces carries a reproduction
 * counter, in any form, ever.
 *
 * WHAT MOVED OUT OF THIS FILE AND WHY. The query rendering and the observe batching
 * used to be inlined here; they now live in `discover.ts` and `observe.ts`, matching
 * the other two sources. The reason is not tidiness: the most important lines in
 * both are REFUSALS — the cutoff that cannot be honoured, and the ids that cannot be
 * addressed — and a refusal inlined in an adapter method cannot be tested without
 * standing up a meter and a clock. What is left below is assembly and metering.
 *
 * ★ EVERY PAID CALL GOES THROUGH `metered`, AND THE UNIT IS THE RUN. A run costs the
 * same whether it returns a thousand items or none, so `units: 1` per call is the
 * measured truth here, and counting returned items would price a per-run vendor with
 * per-item arithmetic. The Budget is handed in and never read from a global: the
 * adapter reports, the meter refuses, and what to give up when money runs short is a
 * product judgement that lives in core.
 */

import type { CounterSet, Item, Millis } from '@insidor/contracts';
import type { Budget, Meter, Metered } from '@insidor/contracts/ports/meter.ts';
import type { DiscoveryQuery, Discovered, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { mergeSpend, metered } from '@insidor/meter';
import type { PriceBook } from '@insidor/meter';
import { discovered } from '@insidor/vendor-kit';

import { CAPABILITIES, DISCOVER, OBSERVE, PRICES, SOURCE, VENDOR } from './capabilities.ts';
import type { TikTokClient } from './client.ts';
import { discoverRun } from './discover.ts';
import { addressable, chunk, observeBatch } from './observe.ts';
import { toItem } from './to-item.ts';

export interface TikTokAdapterDeps {
  readonly client: TikTokClient;
  readonly meter: Meter;
  /** Injected so a recorded run replays to the same Items. Never `Date.now`. */
  readonly now: () => Millis;
  /**
   * Observation addresses posts by URL, so the caller must supply the handle for each
   * id. An absent handle is skipped rather than guessed — a wrong URL costs a run and
   * returns nothing, which then reads downstream as a deleted post.
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

      const result = await metered(
        deps.meter,
        prices,
        // One run is one unit. Counting returned items here would price a per-run
        // vendor with per-item arithmetic.
        { vendor: VENDOR, endpoint: DISCOVER, unit: 'per-run', estUnits: 1, at },
        async () => {
          const run = await discoverRun(deps.client, query, at);
          return { value: run.items, units: 1 };
        },
      );

      // The actor has no cursor: a run returns what it returns, and it never tells us
      // whether there was more. `false` is what the vendor supports saying, not a
      // guess about the feed.
      return { value: discovered(result.value, null, false), spend: result.spend };
    },

    async observe(
      sourceItemIds: readonly string[],
      _budget: Budget,
    ): Promise<Metered<ReadonlyMap<string, CounterSet>>> {
      const at = deps.now();
      const out = new Map<string, CounterSet>();
      const spends = [];

      for (const batch of chunk(addressable(sourceItemIds, deps.handleOf), batchSize)) {
        const result = await metered(
          deps.meter,
          prices,
          { vendor: VENDOR, endpoint: OBSERVE, unit: 'per-run', estUnits: 1, at },
          async () => ({ value: await observeBatch(deps.client, batch, at), units: 1 }),
        );
        for (const [id, counters] of result.value.counters) out.set(id, counters);
        spends.push(result.spend);
      }

      return {
        value: out,
        /* ★ ZERO BATCHES IS ZERO SPEND, AND IT REACHES THE LEDGER AS A REAL ROW OF
           ZEROS RATHER THAN AS NOTHING. Every id being unaddressable is a legitimate
           outcome — see `addressable` — and it means no run happened, so nothing was
           billed. `mergeSpend` over an empty list produces exactly that. */
        spend: mergeSpend(spends, { vendor: VENDOR, endpoint: OBSERVE, unit: 'per-run', estUnits: 1, at }, 'per-run'),
      };
    },

    toItem(raw: unknown, at: Millis): Item {
      return toItem(raw, at);
    },

    /**
     * The cohort. Reach on this source is autoplay-driven and moves with the sound as
     * much as with the poster, so the shared sound is part of what makes two numbers
     * comparable. The key is a label; the thresholds are core's.
     */
    baselineKey(item: Item, _at: Millis): string {
      const sound = item.formatIds.find((f) => f.startsWith(`${SOURCE}:sound:`)) ?? 'nosound';
      return `${SOURCE}|${item.lang ?? 'und'}|${sound}`;
    },
  };
}

export { CAPABILITIES, FIDELITY, PRICES, SOURCE, VENDOR } from './capabilities.ts';
export { httpClient, isActorId, isPathSegment, postUrl } from './client.ts';
/* The typed "we were never configured to call this source". Exported so a caller
   failing closed can tell it from an outage without parsing a message — the registry
   already turns it into `misconfigured`, and this is how anything else checks. */
export { TikTokNotConfigured } from './client.ts';
/* What this source needs from the environment, declared beside the client that
   consumes it. The registry reads it; nothing central holds a copy to drift from. */
export { CREDENTIALS, clientConfig } from './credentials.ts';
export type { TikTokClient, TikTokClientConfig } from './client.ts';
/* The refusal, exported so it is reachable from a test that never builds an adapter.
   It is the single most important line in this package after `capabilities.absent`. */
export { toActorInput } from './discover.ts';
export { toItem, toCounters, formatIds } from './to-item.ts';
