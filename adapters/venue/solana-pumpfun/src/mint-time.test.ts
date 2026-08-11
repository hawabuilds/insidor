/**
 * Mint time decides whether a post came before a coin, which decides whether
 * anything is shown at all. Every branch is tested because the failure mode is
 * a confident wrong number, and confident wrong numbers do not raise errors.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { assertMintTimeInvariants, mintTime } from './mint-time.ts';

const OPTS = { agreementToleranceMs: 60_000 };
const T = 1_785_912_030_000;

test('two sources agreeing within tolerance is the only way to earn exact', () => {
  const m = mintTime({ issuerMs: T, chainMs: T + 1_000, vendorMs: null }, OPTS);
  assert.equal(m.confidence, 'exact');
  assert.equal(m.source, 'issuer_api');
  assert.equal(m.at, T);
});

test('two sources disagreeing produce unknown — not an average, not the earlier one', () => {
  const m = mintTime({ issuerMs: T, chainMs: T + 22 * 60_000, vendorMs: null }, OPTS);
  assert.equal(m.confidence, 'unknown');
  assert.equal(m.at, null);
});

test('one unconfirmed venue reading is bounded by the tolerance, never exact', () => {
  const m = mintTime({ issuerMs: T, chainMs: null, vendorMs: null }, OPTS);
  assert.equal(m.confidence, 'bounded');
  assert.equal(m.boundS, 60);
});

test('an aggregator field can never be exact and states no bound it cannot justify', () => {
  const m = mintTime({ issuerMs: null, chainMs: null, vendorMs: T }, OPTS);
  assert.equal(m.source, 'vendor_field');
  assert.equal(m.confidence, 'unknown');
  assert.equal(m.boundS, null);
});

test('no source at all is unknown with no instant', () => {
  const m = mintTime({ issuerMs: null, chainMs: null, vendorMs: null }, OPTS);
  assert.deepEqual(m, { at: null, source: 'none', confidence: 'unknown', boundS: null });
});

test('a chain read on its own is exact — it is independent of the venue', () => {
  const m = mintTime({ issuerMs: null, chainMs: T, vendorMs: null }, OPTS);
  assert.equal(m.source, 'chain_rpc');
  assert.equal(m.confidence, 'exact');
});

test('the database CHECKs are asserted here, before a Buy button renders', () => {
  assert.throws(() =>
    assertMintTimeInvariants({ at: T, source: 'vendor_field', confidence: 'exact', boundS: null }),
  );
  assert.throws(() =>
    assertMintTimeInvariants({ at: T, source: 'issuer_api', confidence: 'bounded', boundS: null }),
  );
});
