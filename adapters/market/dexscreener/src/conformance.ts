/**
 * What this package hands the shared conformance suite.
 *
 * It is a plain object rather than a typed import from the suite, because the
 * suite imports every adapter and an adapter that imported the suite back would
 * be a cycle. The suite types this structurally at the point of use.
 *
 * ★ WHERE A VENUE DIFFERS FROM A PLATFORM HERE. A platform hands over raw
 * recorded payloads and lets the suite drive the adapter. A venue hands over
 * `MarketState`s that THIS PACKAGE'S OWN MAPPERS have already produced — the
 * translation happens on the lines below — because the venue port is a shape and
 * the suite has no business knowing that this particular vendor spells depth
 * `liquidity.usd`. The suite checks the result and nothing about how it was made.
 *
 * Which means this list IS the venue's test surface, and a state dropped from it
 * is not a shorter test run: it is a market shape the contract silently stops
 * covering. The one rule that contract exists to hold — absent is not zero — can
 * only ever be exercised by the states that carry an absence, so the curve and
 * empty entries are load-bearing however redundant they look beside the pooled
 * one.
 */

import { CURVE_RESPONSE, EMPTY_RESPONSE, LIVE_RESPONSE, POOLED_RESPONSE } from './__fixtures__/pairs.ts';
import { toMarketState } from './to-market-state.ts';
import type { MarketReadContext } from './to-market-state.ts';
import { CHAIN, VENUE_ID } from './index.ts';

const ctx: MarketReadContext = {
  asset: { chain: CHAIN, address: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin' },
  venue: VENUE_ID,
  observedAt: 1_785_913_500_000,
  vendor: 'dexscreener',
  endpoint: 'GET /token-pairs/v1/{chain}/{address}',
};

export const conformance = {
  venueId: VENUE_ID,
  market: 'pool' as const,
  states: [
    toMarketState(POOLED_RESPONSE, ctx),
    toMarketState(CURVE_RESPONSE, ctx),
    // The whole live payload, so the contract suite runs over the fields the
    // mappers are supposed to ignore as well as the ones they read.
    toMarketState(LIVE_RESPONSE, ctx),
    // The commonest answer this vendor gives about a coin minted minutes ago.
    // It belongs under the contract suite precisely because it looks like
    // nothing: every number absent, no depth, no basis — and not one zero.
    toMarketState(EMPTY_RESPONSE, ctx),
  ],
  quotes: [],
};
