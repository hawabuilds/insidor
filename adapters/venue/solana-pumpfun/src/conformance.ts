/**
 * What this package hands the shared conformance suite.
 *
 * The samples are produced by the pure mappers rather than by calling the
 * venue, so the suite needs no network, no key and no fixture server — the same
 * property that lets eval run against recordings.
 */

import type { MintTime } from '@insidor/contracts/asset.ts';

import { toTransferRules } from './assess.ts';
import { toMarketState } from './read.ts';
import type { ReadContext } from './read.ts';
import { quoteBuy } from './trade.ts';
import { FRESH_COIN, SAFE_ACCOUNT } from './__fixtures__/coins.ts';
import { BASE_DECIMALS, CHAIN, TOKEN_DECIMALS, VENUE_ID } from './index.ts';

const ASSET = { chain: CHAIN, address: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin' };
const OBSERVED_AT = 1_785_912_400_000;

/** Two sources agreed, so this one earned 'exact'. See mint-time.ts. */
const MINTED_AT: MintTime = {
  at: 1_785_912_090_000,
  source: 'issuer_api',
  confidence: 'exact',
  boundS: null,
};

const readContext: ReadContext = {
  asset: ASSET,
  venue: VENUE_ID,
  observedAt: OBSERVED_AT,
  baseUsd: 180,
  tokenDecimals: TOKEN_DECIMALS,
  mintedAt: MINTED_AT,
  transferRules: toTransferRules(SAFE_ACCOUNT),
  endpoint: 'GET /coins/{address}',
  vendor: 'pumpfun',
};

const quoted = quoteBuy(
  { asset: ASSET, side: 'buy', inAmount: 1_000_000_000n, slippageBps: 100 },
  {
    venue: VENUE_ID,
    reserves: {
      virtualBaseUnits: 30_450_000_000n,
      virtualTokenUnits: 1_060_000_000_000_000n,
      realBaseUnits: 450_000_000n,
      complete: false,
    },
    tokenDecimals: TOKEN_DECIMALS,
    baseDecimals: BASE_DECIMALS,
    observedAt: OBSERVED_AT,
    networkLamports: 5_000n,
    priorityLamports: 200_000n,
    needsTokenAccount: true,
    platformFeeBps: 50,
    baseUsd: 180,
  },
);

export const conformance = {
  venueId: VENUE_ID,
  market: 'bonding-curve' as const,
  states: [toMarketState(FRESH_COIN, readContext)],
  quotes: quoted.kind === 'quoted' ? [quoted.quote] : [],
};
