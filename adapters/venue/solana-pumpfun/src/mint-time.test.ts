/**
 * Mint time decides whether a post came before a coin, which decides whether
 * anything is shown at all. Every branch is tested because the failure mode is
 * a confident wrong number, and confident wrong numbers do not raise errors.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { assertMintTimeInvariants, mintTime } from './mint-time.ts';

const OPTS = { agreementToleranceMs: 60_000, observationLagS: 10 };
const T = 1_785_912_030_000;
const NONE = { issuerMs: null, chainMs: null, vendorMs: null, observedMs: null };

test('two sources agreeing within tolerance is the only way to earn exact', () => {
  const m = mintTime({ ...NONE, issuerMs: T, chainMs: T + 1_000 }, OPTS);
  assert.equal(m.confidence, 'exact');
  assert.equal(m.source, 'issuer_api');
  assert.equal(m.at, T);
});

test('two sources disagreeing produce unknown — not an average, not the earlier one', () => {
  const m = mintTime({ ...NONE, issuerMs: T, chainMs: T + 22 * 60_000 }, OPTS);
  assert.equal(m.confidence, 'unknown');
  assert.equal(m.at, null);
});

test('one unconfirmed venue reading is bounded by the tolerance, never exact', () => {
  const m = mintTime({ ...NONE, issuerMs: T }, OPTS);
  assert.equal(m.confidence, 'bounded');
  assert.equal(m.boundS, 60);
});

test('an aggregator field can never be exact and states no bound it cannot justify', () => {
  const m = mintTime({ ...NONE, vendorMs: T }, OPTS);
  assert.equal(m.source, 'vendor_field');
  assert.equal(m.confidence, 'unknown');
  assert.equal(m.boundS, null);
});

test('no source at all is unknown with no instant', () => {
  const m = mintTime(NONE, OPTS);
  assert.deepEqual(m, { at: null, source: 'none', confidence: 'unknown', boundS: null });
});

test('a chain read on its own is exact — it is independent of the venue', () => {
  const m = mintTime({ ...NONE, chainMs: T }, OPTS);
  assert.equal(m.source, 'chain_rpc');
  assert.equal(m.confidence, 'exact');
});

/* ── the live observation ───────────────────────────────────────────────── */

test('a live observation is bounded, second-hand, and never exact', () => {
  const m = mintTime({ ...NONE, observedMs: T }, OPTS);
  assert.equal(m.confidence, 'bounded', 'a socket event bounds the mint; it does not date it');
  assert.equal(m.source, 'vendor_field', 'a relay is second-hand however live it is');
  assert.notEqual(m.source, 'issuer_api');
});

test('★ the observation is CENTRED, so the interval ends at the instant we were told', () => {
  // The claim is "the mint happened in the 10 seconds before T". `boundS` is a
  // half-width, so the only encoding of that is a midpoint 5s back with a 5s
  // half-width. Writing `at: T, boundS: 10` claims the mint may have happened
  // FIVE SECONDS AFTER we heard about it, and biases every stored time late —
  // in the exact direction that makes a post look pre-mint.
  const m = mintTime({ ...NONE, observedMs: T }, OPTS);
  assert.equal(m.boundS, 5);
  assert.equal(m.at, T - 5_000);
  assert.equal((m.at ?? 0) + (m.boundS ?? 0) * 1_000, T, 'the interval ends at the observation');
  assert.equal((m.at ?? 0) - (m.boundS ?? 0) * 1_000, T - 10_000, 'and starts one lag before it');
});

test('an odd lag widens the interval rather than narrowing it', () => {
  const m = mintTime({ ...NONE, observedMs: T }, { ...OPTS, observationLagS: 7 });
  assert.equal(m.boundS, 4, 'ceil, not round: containing the truth beats being tight');
  assert.equal((m.at ?? 0) - 4_000, T - 8_000);
});

test('a real source outranks an observation, because a timestamp beats an arrival', () => {
  const m = mintTime({ ...NONE, issuerMs: T - 90_000, observedMs: T }, OPTS);
  assert.equal(m.at, T - 90_000, 'the issuer said when; the socket only said by when');
  assert.equal(m.source, 'issuer_api');
});

test('the observation and the aggregator share a source and differ in confidence', () => {
  // Both are 'vendor_field' and that is correct: both are second-hand. What
  // separates them is whether an honest bound exists — a relay hop has a
  // ceiling, a re-derived origin time measured at +22 minutes median does not.
  const live = mintTime({ ...NONE, observedMs: T }, OPTS);
  const derived = mintTime({ ...NONE, vendorMs: T }, OPTS);
  assert.equal(live.source, derived.source);
  assert.equal(live.confidence, 'bounded');
  assert.equal(derived.confidence, 'unknown');
});

test('a bounded observation is a resolve candidate; an unknown one is not', () => {
  // `mintedBetween` filters `minted_at_conf <> 'unknown'`, so this is the
  // difference between a coin the board can order against a post and a coin
  // that exists and can never be one.
  const m = mintTime({ ...NONE, observedMs: T }, OPTS);
  assert.notEqual(m.confidence, 'unknown');
});

test('the database CHECKs are asserted here, before a Buy button renders', () => {
  assert.throws(() =>
    assertMintTimeInvariants({ at: T, source: 'vendor_field', confidence: 'exact', boundS: null }),
  );
  assert.throws(() =>
    assertMintTimeInvariants({ at: T, source: 'issuer_api', confidence: 'bounded', boundS: null }),
  );
});
