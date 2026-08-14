/** What this package hands the shared conformance suite. */

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
