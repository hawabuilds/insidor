/**
 * The decision constructor, tested directly.
 *
 * Every stage in this package goes through `decide()` and none of them may build a
 * Decision by hand, so the three fields it computes are computed exactly once in the
 * whole system — and until this file existed, nothing asserted any of them except
 * through a stage that happened to exercise them.
 *
 * The first test is here because of a real failure. The first decision ever written
 * to a database was rejected by Postgres — `horizon_s` is an `integer` and this
 * returned 23507.164 — and every row whose subject carried a post time was refused.
 * The rows that landed were the ones with no origin, where the field is null. That is
 * a bug an empty decision log hides perfectly, and it stayed hidden for as long as
 * nothing had ever written a row.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { DecisionDraft, StageContext } from '@insidor/contracts/decision.ts';

import { decide } from './decide.ts';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

const CTX: StageContext = { now: 10 * MINUTE, policyHash: 'p', seed: 'admit:it_1' };

function draft(over: Partial<DecisionDraft> = {}): DecisionDraft {
  return {
    stage: 'admit',
    subjectKind: 'item',
    subjectId: 'it_1',
    featureAsOf: 9 * MINUTE,
    subjectOrigin: 5 * MINUTE,
    verdict: 'pass',
    reason: 'A0_admitted',
    score: null,
    features: { a: 1 },
    featureSet: 'item.admit.v1',
    decider: 'rule:admit@1',
    costUsd: 0,
    ...over,
  };
}

/* ── horizonS ─────────────────────────────────────────────────────────── */

test('horizonS is a whole number of seconds, because the column is an integer', () => {
  // 163 ms of origin offset is below the resolution of both clocks involved: one is
  // a poll cadence, the other is a source's own post time. Carrying it would be
  // false precision, and the store would truncate it silently.
  const d = decide(draft({ subjectOrigin: 5 * MINUTE + 163 }), CTX);

  assert.equal(Number.isInteger(d.horizonS), true);
  assert.equal(d.horizonS, 300);
});

test('horizonS rounds rather than truncating, in both directions', () => {
  assert.equal(decide(draft({ subjectOrigin: 5 * MINUTE + 600 }), CTX).horizonS, 299);
  assert.equal(decide(draft({ subjectOrigin: 5 * MINUTE + 400 }), CTX).horizonS, 300);
});

test('horizonS is null when the subject has no known origin, never zero', () => {
  // A zero would say we were exactly on time. "We do not know when this began" is not
  // a horizon of any length, and the two must not be the same row.
  assert.equal(decide(draft({ subjectOrigin: null }), CTX).horizonS, null);
});

/* ── the two invariants that throw ────────────────────────────────────── */

test('a decision cannot see anything newer than itself', () => {
  // The store repeats this as `CHECK (feature_asof <= decided_at)`. Throwing here
  // fails BEFORE the side effect; the CHECK fails after it.
  assert.throws(
    () => decide(draft({ featureAsOf: 11 * MINUTE }), CTX),
    /featureAsOf .* is after decidedAt/,
  );
});

test('propensity outside (0,1] throws, because zero makes a counterfactual undefined', () => {
  assert.throws(() => decide(draft({ propensity: 0 }), CTX), RangeError);
  assert.throws(() => decide(draft({ propensity: 1.5 }), CTX), RangeError);
  assert.equal(decide(draft({ propensity: 1 }), CTX).propensity, 1);
});

/* ── the clock, and the vector ────────────────────────────────────────── */

test('decidedAt comes from the context and cannot be supplied by a stage', () => {
  // A stage that could set its own decidedAt could set one later than the clock its
  // features were built against, which is lookahead with the evidence removed.
  assert.equal(decide(draft(), CTX).decidedAt, CTX.now);
});

test('the feature vector is frozen, not copied', () => {
  // It must be the object the decider actually read — a copy would let a later stage
  // edit the original and leave the log describing a vector nobody decided on.
  const features = { a: 1, absent: null };
  const d = decide(draft({ features }), CTX);

  assert.equal(d.features, features);
  assert.equal(Object.isFrozen(d.features), true);
});

test('explore follows the arm, so the two can never disagree', () => {
  assert.equal(decide(draft(), CTX).explore, false);
  const drawn = decide(draft({ exploreArm: 'holdout', propensity: 0.02 }), CTX);
  assert.equal(drawn.explore, true);
  assert.equal(drawn.exploreArm, 'holdout');
});
