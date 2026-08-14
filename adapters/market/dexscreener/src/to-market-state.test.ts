/**
 * Two fixtures, one distinction, and the most expensive bug in the previous
 * build sits exactly between them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { chainId, venueId } from '@insidor/contracts/ids.ts';

import {
  CURVE_RESPONSE,
  DRAINED_RESPONSE,
  EMPTY_RESPONSE,
  LIVE_RESPONSE,
  POOLED_RESPONSE,
} from './__fixtures__/pairs.ts';
import { pickPricePair, toMarketState, toPairView } from './to-market-state.ts';
import type { MarketReadContext } from './to-market-state.ts';

const CHAIN = chainId('solana');

const ctx: MarketReadContext = {
  asset: { chain: CHAIN, address: '9xQe' },
  venue: venueId(CHAIN, 'pool'),
  observedAt: 1_785_913_500_000,
  vendor: 'dexscreener',
  endpoint: 'GET /token-pairs/v1/{chain}/{address}',
};

test('an absent liquidity object is null — a drained pool is zero', () => {
  const curve = toMarketState(CURVE_RESPONSE, ctx);
  const drained = toMarketState(DRAINED_RESPONSE, ctx);

  assert.equal(curve.liquidityUsd, null);
  assert.equal(drained.liquidityUsd, 0);
  assert.notEqual(curve.liquidityUsd, drained.liquidityUsd);
});

test('a curve pair still has a price, and is not discarded for lacking a reserve', () => {
  const curve = toMarketState(CURVE_RESPONSE, ctx);
  assert.equal(curve.priceUsd, 0.0000214);
  assert.equal(curve.depth?.kind, 'bonding-curve');
  assert.equal(curve.marketCapUsd, 21_400);
  assert.equal(curve.marketCapBasis, 'fully-diluted');
});

test('a pooled pair reports its depth and how many pools back it', () => {
  const pooled = toMarketState(POOLED_RESPONSE, ctx);
  assert.ok(pooled.depth?.kind === 'pool');
  assert.equal(pooled.depth.liquidityUsd, 42_000);
  assert.equal(pooled.depth.poolCount, 2);
  assert.equal(pooled.marketCapBasis, 'circulating');
});

test("the day's price move comes from the pair the price came from, and is signed", () => {
  /* Two pools, two different h24 figures, and the deeper one is where the price is
     read. Taking the other would put one market's price beside another market's
     move in the same row, which is two claims about two things wearing one label. */
  const pooled = toMarketState(POOLED_RESPONSE, ctx);
  assert.equal(pooled.priceChange24hPct, 12.5);
  assert.notEqual(pooled.priceChange24hPct, -3.1, 'the thinner pool decided the move');

  /* And a fall stays a fall. The guard that turns a negative reserve into null must
     never be pointed at this field: it would delete exactly the coins that dropped,
     leaving a board on which nothing ever goes down. */
  const live = toMarketState(LIVE_RESPONSE, ctx);
  assert.equal(live.priceChange24hPct, -6.94);
});

test('a pair younger than a day reports no change, not a change of zero', () => {
  /* CURVE_RESPONSE has no `priceChange` key at all — the same absence as its missing
     `liquidity`, for the same reason: the concept does not exist for this pair yet.
     A 0 here would say the price held for a day the coin has not been alive for. */
  const curve = toMarketState(CURVE_RESPONSE, ctx);
  assert.equal(curve.priceChange24hPct, null);
  assert.notEqual(curve.priceChange24hPct, 0);

  assert.equal(toMarketState(EMPTY_RESPONSE, ctx).priceChange24hPct, null);
});

test('this vendor can never supply a mint time', () => {
  for (const raw of [CURVE_RESPONSE, POOLED_RESPONSE, DRAINED_RESPONSE]) {
    assert.equal(toMarketState(raw, ctx).mintedAt.confidence, 'unknown');
  }
});

test('a token this vendor has never seen produces nulls, not zeros', () => {
  const empty = toMarketState(EMPTY_RESPONSE, ctx);
  assert.equal(empty.priceUsd, null);
  assert.equal(empty.liquidityUsd, null);
  assert.equal(empty.depth, null);
  assert.equal(empty.marketCapBasis, null);
});

test('a pair with no liquidity object is ranked last but never excluded', () => {
  const curve = toPairView({ dexId: 'pumpfun', priceUsd: '1' });
  const pool = toPairView({ dexId: 'raydium', priceUsd: '1', liquidity: { usd: 5 } });
  assert.equal(pickPricePair([curve, pool])?.dexId, 'raydium');
  assert.equal(pickPricePair([curve])?.dexId, 'pumpfun', 'a lone curve pair is still the answer');
  assert.equal(pickPricePair([]), null);
});

test('curve venues are recognised as a class, not as one launchpad', () => {
  assert.equal(toPairView({ dexId: 'meteoradbc' }).isCurve, true);
  assert.equal(toPairView({ dexId: 'pumpfun' }).isCurve, true);
  assert.equal(toPairView({ dexId: 'raydium' }).isCurve, false);
});
