/**
 * The pooled-market venue: reads only.
 *
 * It is registered as a venue rather than as a loose helper because "where do I
 * read this asset's price?" has to have one answer per venue, and because the
 * conformance suite runs against venues. Its capability list has a single entry
 * — `read` — and the absence of `trade` is what stops anything trying to
 * execute through a data vendor. That absence is checked by the compiler, not
 * by a runtime throw.
 */

import type { Millis } from '@insidor/contracts';
import type { MarketState } from '@insidor/contracts/asset.ts';
import { chainId, venueId } from '@insidor/contracts/ids.ts';
import type { AssetRef, ChainId, VenueId } from '@insidor/contracts/ids.ts';
import type { Budget, Meter, Metered } from '@insidor/contracts/ports/meter.ts';
import type { Venue } from '@insidor/contracts/ports/venue.ts';
import { mergeSpend, metered } from '@insidor/meter';
import type { Price, PriceBook } from '@insidor/meter';

import { MAX_ADDRESSES_PER_CALL } from './client.ts';
import type { MarketClient } from './client.ts';
import { toMarketState } from './to-market-state.ts';

export const CHAIN: ChainId = chainId('solana');
export const VENUE_ID: VenueId = venueId(CHAIN, 'pool');
export const VENDOR = 'dexscreener';

const PAIRS = 'pairs';
const ENDPOINT = 'GET /token-pairs/v1/{chain}/{address}';

const price: Price = {
  vendor: VENDOR,
  endpoint: PAIRS,
  // Free, but rate-limited — which is a budget of a different kind and is the
  // reason the caller batches. A zero marginal cost is not a licence to loop.
  unit: 'flat',
  usdPerUnit: 0,
  unitName: 'call on a free, rate-limited endpoint',
  measuredAt: '2026-08-05',
};

export const PRICES: PriceBook = { [`${VENDOR}:${PAIRS}`]: price };

export interface MarketVenueDeps {
  readonly client: MarketClient;
  readonly meter: Meter;
  readonly now: () => Millis;
  /** Adjudicated labels for this venue. Read from the store, never assumed. */
  readonly adjudicatedLabels: number;
  readonly prices?: PriceBook;
}

export function dexscreenerVenue(deps: MarketVenueDeps): Venue {
  const prices = deps.prices ?? PRICES;

  const read = async (asset: AssetRef, at: Millis): Promise<Metered<MarketState>> => {
    const raw = await metered(
      deps.meter,
      prices,
      { vendor: VENDOR, endpoint: PAIRS, unit: 'flat', estUnits: 1, at },
      async () => ({ value: await deps.client.pairsForToken(asset.chain, asset.address), units: 1 }),
    );

    return {
      value: toMarketState(raw.value, { asset, venue: VENUE_ID, observedAt: at, vendor: VENDOR, endpoint: ENDPOINT }),
      spend: raw.spend,
    };
  };

  return {
    id: VENUE_ID,
    chain: CHAIN,
    market: 'pool',
    capabilities: ['read'],
    enabled: true,
    adjudicatedLabels: deps.adjudicatedLabels,

    read: {
      async state(asset: AssetRef, _budget: Budget): Promise<Metered<MarketState>> {
        return read(asset, deps.now());
      },

      /**
       * Batched because the endpoint rate-limits after about eleven sequential
       * calls, and the code this replaces ran a 250 ms delay — 240 requests a
       * minute, straight into the ceiling.
       */
      async states(assets: readonly AssetRef[], _budget: Budget): Promise<Metered<readonly MarketState[]>> {
        const at = deps.now();
        const out: MarketState[] = [];
        const spends = [];

        for (let i = 0; i < assets.length; i += MAX_ADDRESSES_PER_CALL) {
          const batch = assets.slice(i, i + MAX_ADDRESSES_PER_CALL);
          const raw = await metered(
            deps.meter,
            prices,
            { vendor: VENDOR, endpoint: PAIRS, unit: 'flat', estUnits: 1, at },
            async () => ({
              value: await deps.client.pairsForTokens(
                batch[0]?.chain ?? CHAIN,
                batch.map((a) => a.address),
              ),
              units: 1,
            }),
          );
          spends.push(raw.spend);

          // The batch endpoint returns one flat list of pairs, so each asset is
          // filtered out of it by address rather than by position — position
          // would silently pair an asset with someone else's market.
          for (const asset of batch) {
            out.push(
              toMarketState(pairsFor(raw.value, asset.address), {
                asset,
                venue: VENUE_ID,
                observedAt: at,
                vendor: VENDOR,
                endpoint: ENDPOINT,
              }),
            );
          }
        }

        return {
          value: out,
          spend: mergeSpend(spends, { vendor: VENDOR, endpoint: PAIRS, unit: 'flat', estUnits: 1, at }, 'flat'),
        };
      },
    },
  };
}

/** Narrows a multi-asset response to one asset's pairs, by address. */
function pairsFor(raw: unknown, address: string): unknown {
  const pairs = (raw as { readonly pairs?: readonly unknown[] } | null)?.pairs ?? [];
  return {
    pairs: pairs.filter((p) => {
      const base = (p as { readonly baseToken?: { readonly address?: unknown } } | null)?.baseToken?.address;
      return base === address;
    }),
  };
}

export { httpClient, MAX_ADDRESSES_PER_CALL } from './client.ts';
export type { MarketClient, MarketClientConfig } from './client.ts';
export { toMarketState, toPairView, pickPricePair, CURVE_DEX_IDS } from './to-market-state.ts';
export type { MarketReadContext, PairView } from './to-market-state.ts';
