/**
 * The Reddit adapter, assembled. Adding a platform is this folder plus one line
 * in adapters/platform/registry.
 *
 * Read `capabilities.ts` before changing anything here. This package makes two
 * promises that the rest of it exists to keep: no Item it produces carries a
 * `reach` counter in any form, and the vote counter it does produce is declared
 * `fuzzed`, which means the censoring rule will refuse to difference it. Both
 * are claims about what this source is, not defaults.
 *
 * Every call goes through `metered` even though every call is free, because the
 * ledger is a record of what was ASKED rather than of what was billed. See the
 * price-book comment in capabilities.ts for why the unit is 'per-call' and why
 * `freeSpend` would be the wrong shape.
 */

import type { CounterSet, Item, Millis } from '@insidor/contracts';
import type { Budget, Meter, Metered } from '@insidor/contracts/ports/meter.ts';
import type { DiscoveryQuery, Discovered, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { mergeSpend, metered } from '@insidor/meter';
import type { PriceBook } from '@insidor/meter';
import { discovered } from '@insidor/vendor-kit';

import { CAPABILITIES, INFO, LISTING, PRICES, SOURCE, VENDOR } from './capabilities.ts';
import type { RedditClient } from './client.ts';
import { discoverPage } from './discover.ts';
import { chunk, observeBatch } from './observe.ts';
import { communityOfRawRef, toItem } from './to-item.ts';

export interface RedditAdapterDeps {
  readonly client: RedditClient;
  readonly meter: Meter;
  /** Injected so a recorded run replays to the same Items. Never `Date.now`. */
  readonly now: () => Millis;
  /** Defaults to this source's price book; overridable when the terms change. */
  readonly prices?: PriceBook;
}

/** The cohort label for a post whose payload named no community we could use. */
const NO_COMMUNITY = 'nocommunity';

export function redditPlatform(deps: RedditAdapterDeps): PlatformAdapter {
  const prices = deps.prices ?? PRICES;
  const batchSize = CAPABILITIES.observeBatchSize ?? 1;

  return {
    id: SOURCE,
    capabilities: CAPABILITIES,

    async discover(query: DiscoveryQuery, _budget: Budget): Promise<Metered<Discovered>> {
      const at = deps.now();

      /**
       * ★ `budget` IS ACCEPTED AND NOT READ, AND THAT IS WORTH ONE PARAGRAPH
       * RATHER THAN A SHRUG, BECAUSE THIS IS THE SOURCE WHERE IT MATTERS MOST.
       *
       * At $0 per unit the dollar meter cannot refuse anything — `mayspend`
       * consults a price of zero and always says yes — so the only budget that
       * binds here is the vendor's requests-per-minute quota. The field for
       * that is `Budget.maxCalls`, and no adapter in this repository reads it.
       *
       * This one does not either, and the reason is that it CANNOT honour it
       * correctly: `maxCalls` is a ceiling on a unit of work, and an adapter
       * sees only the calls it makes itself. Enforcing it here would enforce a
       * per-verb ceiling that nobody declared, which is worse than not
       * enforcing it — the number would appear to be respected while meaning
       * something else. What this package does instead is make the constraint
       * VISIBLE: every call is one metered unit, and the client reports the
       * vendor's own remaining-quota header to whoever wired it. Deciding what
       * to give up when the quota runs short is a product judgement and belongs
       * in core, holding the whole run's call count.
       */
      const result = await metered(
        deps.meter,
        prices,
        // One request is one unit. The unit that is rationed is the request.
        { vendor: VENDOR, endpoint: LISTING, unit: 'per-call', estUnits: 1, at },
        async () => ({ value: await discoverPage(deps.client, query, at), units: 1 }),
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
          { vendor: VENDOR, endpoint: INFO, unit: 'per-call', estUnits: 1, at },
          async () => ({ value: await observeBatch(deps.client, batch, at), units: 1 }),
        );
        for (const [id, counters] of result.value.counters) out.set(id, counters);
        spends.push(result.spend);
      }

      return {
        value: out,
        // One logical read, however many batches it took. Each batch was
        // already recorded individually; this is the summary that travels with
        // the value, and on this source it is a true count of quota consumed.
        spend: mergeSpend(
          spends,
          { vendor: VENDOR, endpoint: INFO, unit: 'per-call', estUnits: 1, at },
          'per-call',
        ),
      };
    },

    toItem(raw: unknown, at: Millis): Item {
      return toItem(raw, at);
    },

    /**
     * The cohort this item's numbers may be compared against.
     *
     * TWO AXES, AND THE FIRST IS THE ONE THAT MATTERS HERE. A thread's comment
     * count — the only counter this source publishes that we are willing to
     * difference — is set almost entirely by WHERE it was posted: the same
     * forty comments are extraordinary in a small community and unremarkable in
     * a large one, and comparing across them compares nothing. The hour is the
     * second axis for the ordinary reason it is on the other source: comment
     * arrival follows a daily cycle, so the same rate means different things at
     * different times of day.
     *
     * ★ THE COMMUNITY REACHES THIS FUNCTION THROUGH `rawRef`, WHICH LOOKS ODD
     * UNTIL YOU TRY THE ALTERNATIVES. `baselineKey` is handed only an `Item`,
     * and `Item` carries no per-source context field — deliberately, because
     * adding one would put this platform's word in the shared vocabulary. The
     * storage key is this package's own opaque string and it organises blobs by
     * community, which is what one would do anyway; both directions of that
     * format live in `to-item.ts`, in one pair of functions with a round-trip
     * test, so the layout and this reader cannot drift apart. The full argument,
     * including why `formatIds` is the wrong route, is at `rawRefFor`.
     *
     * The language is deliberately NOT in the key: this source publishes none,
     * so every item would contribute the same placeholder and the component
     * would be decoration. An axis that never varies is worse than an absent
     * one, because it reads as though it does.
     *
     * The key is a LABEL. Every threshold applied to it is core's.
     */
    baselineKey(item: Item, at: Millis): string {
      const community = communityOfRawRef(item.rawRef) ?? NO_COMMUNITY;
      const hour = new Date(at).getUTCHours();
      return `${SOURCE}|${community}|h${String(hour).padStart(2, '0')}`;
    },
  };
}

export {
  CAPABILITIES,
  FIDELITY,
  PRICES,
  RATE_LIMIT_PER_MIN,
  SOURCE,
  VENDOR,
} from './capabilities.ts';
export { httpClient, decodeListing, parseQuota, RedditNotConfigured } from './client.ts';
export type { ListingPage, ListingRequest, QuotaReading, RedditClient, RedditClientConfig } from './client.ts';
export { toListingRequest } from './discover.ts';
/* The citation link. Exported from the barrel because the projector — which
   must never know a URL shape — is the caller, and it asks this package by
   name. `postUrlFromPath` rides along for callers holding a payload; see
   permalink.ts for why the projector cannot be one of them. */
export { postUrl, postUrlFromPath } from './permalink.ts';
export { communityOf, communityOfRawRef, rawRefFor, toCounters, toItem } from './to-item.ts';
