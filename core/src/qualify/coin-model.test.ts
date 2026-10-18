/** The coin model's arithmetic: facts as features, a missing fact never a zero, the fit's own threshold, one space. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';

import { coinModelFeatures, coinModelProbability, coinModelVerdict, oneHotsOf, textHints, type CoinModelFacts, type CoinModelFit } from './coin-model.ts';

const SHADOW = DEFAULT_POLICY;
const OFF: Policy = { ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, coinModel: { ...DEFAULT_POLICY.judge.coinModel, on: false, shadow: false } } };
const MIN = 60_000;

const FACTS: CoinModelFacts = {
  source: 'x', lang: 'en', text: 'Welcome HomeView', mediaKinds: ['video'], postedAtMs: 0, decidedAtMs: 30 * MIN,
  reach: 3000, reachAtMs: 20 * MIN, ratePerMinute: 120, priorRatePerMinute: 60, approval: 50, conversation: 4, rebroadcast: 2, followers: 1000, echoes: 0,
};

test('reach a minute is reach over the age at the reading, and acceleration the change of the log rate', () => {
  const f = coinModelFeatures(FACTS, ['x'], ['en'], SHADOW);
  assert.equal(f['reach_a_minute'], Math.log1p(3000 / 20));
  assert.equal(f['acceleration'], Math.log1p(120) - Math.log1p(60));
  assert.equal(f['age'], Math.log1p(30));
  assert.equal(f['source:x'], 1);
  assert.equal(f['lang:en'], 1);
  assert.equal(f['video'], 1);
});

test('★ a fact not held at the decision is null with its flag, never a zero', () => {
  const f = coinModelFeatures({ ...FACTS, reach: null, reachAtMs: null, ratePerMinute: null, priorRatePerMinute: null, followers: null }, [], [], SHADOW);
  assert.equal(f['reach'], null);
  assert.equal(f['reach_a_minute'], null);
  assert.equal(f['acceleration'], null);
  assert.equal(f['no_reading'], 1);
  assert.equal(f['no_rate'], 1);
  assert.equal(f['no_followers'], 1);
});

test('catchphrase hints: a short marked phrase, a word in capitals, a capitalised word inside a sentence', () => {
  assert.equal(textHints('he said "timing is everything" today', SHADOW)['marked_phrase'], 1);
  assert.equal(textHints('Me and my brother making DIKSHIT', SHADOW)['caps_word'], 1);
  assert.equal(textHints('i love it', SHADOW)['caps_word'], 0);
  assert.equal(textHints('Optimus will build Optimus Prime', SHADOW)['names'], Math.log1p(2));
  assert.equal(textHints('', SHADOW)['no_text'], 1);
});

const FIT: CoinModelFit = {
  id: 3, space: 'post', intercept: -1, names: ['no_vector', 'reach', 'source:x'], means: [0, 5, 0.5], spreads: [1, 2, 0.5], weights: [0.5, 1, 0], vectorWeights: [2, 0], threshold: 0.6,
};

test('the probability is the logistic of the standardised dot product plus the vector part; a missing feature sits at its mean', () => {
  const f = coinModelFeatures(FACTS, ['x'], [], SHADOW);
  const z = -1 + 0 + ((f['reach'] as number) - 5) / 2 + 0 + 2 * 0.5;
  assert.ok(Math.abs((coinModelProbability(f, { space: 'post', values: [0.5, 9] }, FIT) as number) - 1 / (1 + Math.exp(-z))) < 1e-12);
  const none = coinModelFeatures({ ...FACTS, reach: null, reachAtMs: null }, ['x'], [], SHADOW);
  assert.ok(Math.abs((coinModelProbability(none, null, FIT) as number) - 1 / (1 + Math.exp(-(-1 + 0.5)))) < 1e-12, 'no vector: the flag, and reach at its mean');
});

test('★ a vector of another space or length scores as no vector', () => {
  const f = coinModelFeatures(FACTS, ['x'], [], SHADOW);
  assert.equal(coinModelProbability(f, { space: 'picture', values: [0.5, 9] }, FIT), coinModelProbability(f, null, FIT));
  assert.equal(coinModelProbability(f, { space: 'post', values: [0.5] }, FIT), coinModelProbability(f, null, FIT));
});

test("the verdict: off, no fit, the fit's own threshold, and the policy's override", () => {
  assert.deepEqual(coinModelVerdict(FACTS, null, FIT, OFF), { kind: 'unscored', why: 'off' });
  assert.deepEqual(coinModelVerdict(FACTS, null, null, SHADOW), { kind: 'unscored', why: 'no_fit' });
  const v = coinModelVerdict(FACTS, { space: 'post', values: [3, 0] }, FIT, SHADOW);
  assert.equal(v.kind, 'add');
  assert.equal(v.kind === 'add' && v.threshold, 0.6);
  const strict: Policy = { ...SHADOW, judge: { ...SHADOW.judge, coinModel: { ...SHADOW.judge.coinModel, threshold: 0.999 } } };
  assert.equal(coinModelVerdict(FACTS, { space: 'post', values: [3, 0] }, FIT, strict).kind, 'keep_out');
});

test('the one-hots are read back from the fit\'s names', () => {
  assert.deepEqual(oneHotsOf(['lang:en', 'reach', 'source:x', 'source:y']), { sources: ['x', 'y'], langs: ['en'] });
});
