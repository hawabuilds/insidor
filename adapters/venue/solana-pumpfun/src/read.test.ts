/**
 * The first test in this file is the one that unblocks the product: an asset on
 * a bonding curve reports NO liquidity, and no code path may turn that into a
 * zero. Reading absence as zero is what removed the entire pre-graduation
 * population from the previous build.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { MintTime } from '@insidor/contracts/asset.ts';
import { chainId, venueId } from '@insidor/contracts/ids.ts';

import { isTradeable, REQUIRED_ON_CURVE, toTransferRules } from './assess.ts';
import { FRESH_COIN, GRADUATED_COIN, RISKY_ACCOUNT, SAFE_ACCOUNT, UNREADABLE_ACCOUNT } from './__fixtures__/coins.ts';
import { curveProgress, toMarketState, toReserves } from './read.ts';
import type { ReadContext } from './read.ts';

const CHAIN = chainId('solana');
const VENUE = venueId(CHAIN, 'pumpfun');
const ASSET = { chain: CHAIN, address: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin' };
const OBSERVED_AT = 1_785_912_400_000;

const BOUNDED: MintTime = { at: 1_785_912_090_000, source: 'issuer_api', confidence: 'bounded', boundS: 60 };

const ctx: ReadContext = {
  asset: ASSET,
  venue: VENUE,
  observedAt: OBSERVED_AT,
  baseUsd: 180,
  tokenDecimals: 6,
  mintedAt: BOUNDED,
  transferRules: null,
  endpoint: 'GET /coins/{address}',
  vendor: 'pumpfun',
};

test('liquidity is null on a curve, and null is not zero', () => {
  const state = toMarketState(FRESH_COIN, ctx);
  assert.equal(state.liquidityUsd, null);
  assert.notEqual(state.liquidityUsd, 0);
});

test('what backs the price is the curve, and depth says so', () => {
  const state = toMarketState(FRESH_COIN, ctx);
  assert.ok(state.depth?.kind === 'bonding-curve');
  assert.deepEqual(state.depth.slippageBpsAt, { '0.1': null, '0.5': null, '1.0': null });
});

test('the market cap basis is recorded, never inferred', () => {
  assert.equal(toMarketState(FRESH_COIN, ctx).marketCapBasis, 'fully-diluted');
});

test('mint time is carried with its source and confidence, never as a bare number', () => {
  const state = toMarketState(FRESH_COIN, ctx);
  assert.deepEqual(state.mintedAt, BOUNDED);
  assert.equal(state.mintedAt.confidence, 'bounded');
});

test('a price with no base-asset price is null, not zero', () => {
  const state = toMarketState(FRESH_COIN, { ...ctx, baseUsd: null });
  assert.equal(state.priceUsd, null);
});

test('unread transfer rules stay null — a gate that cannot read must not pass', () => {
  assert.equal(toMarketState(FRESH_COIN, ctx).transferRules, null);
});

test('curve progress is a fraction, and a graduated curve is complete', () => {
  const fresh = curveProgress(toReserves(FRESH_COIN));
  assert.ok(fresh !== null && fresh > 0 && fresh < 1);
  assert.equal(curveProgress(toReserves(GRADUATED_COIN)), 1);
  assert.equal(curveProgress(null), null);
});

test('a live issuance authority fails its check, a revoked freeze authority passes', () => {
  const rules = toTransferRules(RISKY_ACCOUNT);
  assert.equal(rules.complete, true);
  assert.equal(rules.issuanceRevoked, false);
  assert.equal(rules.freezeRevoked, true);
  assert.equal(rules.hasTransferHook, true);
  assert.ok(rules.failedChecks.includes('issuance_revoked'));
  assert.ok(rules.failedChecks.includes('no_transfer_hook'));
  assert.equal(isTradeable(rules), false);
});

test('a clean account passes every required check', () => {
  const rules = toTransferRules(SAFE_ACCOUNT);
  assert.equal(rules.complete, true);
  assert.equal(isTradeable(rules), true);
  // Metadata mutability is observed and reported, and is NOT required — every
  // asset here is mutable at mint, so requiring it would suppress every Buy.
  assert.ok(rules.failedChecks.includes('metadata_immutable'));
});

test('an unreadable account is incomplete, and incomplete is not "nothing failed"', () => {
  const rules = toTransferRules(UNREADABLE_ACCOUNT);
  assert.equal(rules.complete, false);
  assert.deepEqual(rules.failedChecks, []);
  assert.equal(rules.issuanceRevoked, null);
  assert.equal(isTradeable(rules), false, 'an unread rule is not a passed rule');
});

test('a check that cannot apply to this venue is absent, not permanently unknown', () => {
  // No pool-burn check: a curve has no pool. A required check that can never be
  // answered would suppress the Buy affordance forever for the wrong reason.
  assert.equal(REQUIRED_ON_CURVE.some((c) => String(c).includes('lp')), false);
  assert.deepEqual(REQUIRED_ON_CURVE, [
    'issuance_revoked',
    'freeze_revoked',
    'no_transfer_fee',
    'no_transfer_hook',
  ]);
});
