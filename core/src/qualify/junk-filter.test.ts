/** The junk filter's decision: the fit's arithmetic, its own threshold, and every missing input is "unscored", never junk. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';

import { junkProbability, junkVerdict, type JunkFit } from './junk-filter.ts';

const ON: Policy = { ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, junkFilter: { ...DEFAULT_POLICY.judge.junkFilter, on: true } } };
const OFF: Policy = { ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, junkFilter: { ...DEFAULT_POLICY.judge.junkFilter, on: false } } };
const fit: JunkFit = { id: 7, space: 'post', intercept: -1, weights: [4, -2], threshold: 0.9 };
const at = (values: number[], space = 'post') => ({ values, space });

test('the probability is the logistic of the intercept plus the dot product', () => {
  assert.equal(junkProbability([0, 0], 'post', fit), 1 / (1 + Math.exp(1)));
  assert.equal(junkProbability([1, 0.5], 'post', fit), 1 / (1 + Math.exp(-2)));
});

test('another space, another length or an empty vector cannot be scored', () => {
  assert.equal(junkProbability([1, 0], 'picture', fit), null);
  assert.equal(junkProbability([1, 0, 0], 'post', fit), null);
  assert.equal(junkProbability([], 'post', { ...fit, weights: [] }), null);
});

test("at or over the fit's own threshold is junk; under it the judge is asked", () => {
  const sure = junkVerdict(at([1, 0]), fit, ON); // logistic(3) ≈ 0.953
  assert.equal(sure.kind, 'junk');
  assert.equal(sure.kind === 'junk' && sure.fitId, 7);
  assert.equal(junkVerdict(at([0.5, 0]), fit, ON).kind, 'ask'); // logistic(1) ≈ 0.73
  const edge = junkProbability([1, 0], 'post', fit) as number;
  assert.equal(junkVerdict(at([1, 0]), { ...fit, threshold: edge }, ON).kind, 'junk');
});

test('off, no fit, no vector or the wrong space: unscored, so the post is judged as if there were no filter', () => {
  assert.deepEqual(junkVerdict(at([1, 0]), fit, OFF), { kind: 'unscored', why: 'off' });
  assert.deepEqual(junkVerdict(at([1, 0]), null, ON), { kind: 'unscored', why: 'no_fit' });
  assert.deepEqual(junkVerdict(null, fit, ON), { kind: 'unscored', why: 'no_vector' });
  assert.deepEqual(junkVerdict(at([1, 0], 'picture'), fit, ON), { kind: 'unscored', why: 'other_space' });
});

test('ships off', () => {
  assert.equal(DEFAULT_POLICY.judge.junkFilter.on, false);
});
