/** The junk filter's decision: the fit's arithmetic, its own threshold, and every missing input is "unscored", never junk. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';

import { forYouJunkBar, junkProbability, junkVerdict, underJunkBar, type HeldOutRow, type JunkFit } from './junk-filter.ts';

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

/* Fit 8's own held-out table (2026-10-20). The coined group's impossible drop count is there to
   show it is never counted. */
const row = (threshold: number, gold: number, missed: number, meme: number, not = 0): HeldOutRow => ({
  threshold,
  dropped: { gold: { tested: 146, dropped: gold }, missed: { tested: 37, dropped: missed }, meme: { tested: 15, dropped: meme }, not: { tested: 1126, dropped: not }, coined: { tested: 784, dropped: 900 } },
});
const TABLE = [row(0.9, 1, 1, 2, 242), row(0.5, 34, 10, 7, 891), row(0.7, 15, 3, 5, 660), row(0.8, 6, 2, 5, 485), row(0.95, 0, 0, 0, 105)];
const bar = (change: Partial<Policy['rising']['junkBar']>): Policy => ({ ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, junkBar: { ...DEFAULT_POLICY.rising.junkBar, ...change } } });

test("For You's bar is the lowest held-out threshold that keeps 95% of the owner's memeable posts", () => {
  // 0.8 keeps 185 of 198 (93%); 0.9 keeps 194 (98%). Rows out of order are sorted first.
  assert.equal(forYouJunkBar(TABLE, DEFAULT_POLICY), 0.9);
});

test('coined posts and Not a memes do not decide the bar: only the keep groups do', () => {
  assert.equal(forYouJunkBar(TABLE, bar({ keepShare: 0.9 })), 0.8);
  assert.equal(forYouJunkBar(TABLE, bar({ keepShare: 1 })), 0.95);
});

test('too few memeable posts tested, or no row that keeps enough: no bar, never a guessed one', () => {
  assert.equal(forYouJunkBar(TABLE, bar({ minTested: 199 })), null);
  assert.equal(forYouJunkBar([row(0.5, 34, 10, 7)], DEFAULT_POLICY), null);
  assert.equal(forYouJunkBar([], DEFAULT_POLICY), null);
});

test('a post joins unless its probability is at or over the bar; no bar or no probability lets it through', () => {
  assert.equal(underJunkBar(0.89, 0.9), true);
  assert.equal(underJunkBar(0.9, 0.9), false);
  assert.equal(underJunkBar(null, 0.9), true);
  assert.equal(underJunkBar(0.99, null), true);
});
