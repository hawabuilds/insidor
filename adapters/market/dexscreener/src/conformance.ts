/** What this package hands the shared conformance suite. */

import { CURVE_RESPONSE, POOLED_RESPONSE } from './__fixtures__/pairs.ts';
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
  states: [toMarketState(POOLED_RESPONSE, ctx), toMarketState(CURVE_RESPONSE, ctx)],
  quotes: [],
};
