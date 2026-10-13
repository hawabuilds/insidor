/** The order model's signals and its number: a missing value is missing, never zero, and a fit reads only its own terms. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY as P } from '@insidor/contracts/policy.ts';

import { postRankScore, postSignals, type RankFacts, type ScoreFit } from './post-rank.ts';

const MIN = 60_000;
const POSTED = 1_000_000_000;
const FACTS: RankFacts = {
  coinable: true, confidence: 0.8, lookedAt: 'picture', proposedName: 'Chill Guy', kindLabel: null,
  pictureSimilarity: 0.5, readings: [{ atMs: POSTED + 10 * MIN, reach: 20_000 }, { atMs: POSTED + 60 * MIN, reach: 50_000 }], postedAtMs: POSTED, reachScale: 1, attention: null,
};

test('a judged post with readings has every signal but the ones it lacks', () => {
  const s = postSignals(FACTS, P);
  assert.equal(s.judge_yes, 1);
  assert.equal(s.judge_unjudged, 0);
  assert.equal(s.judge_belief, 0.8);
  assert.equal(s.looked_picture, 1);
  assert.equal(s.name_test, 1);
  assert.equal(s.reach, Math.log10(1 + 50_000));
  /* growth: the fast path's best rate inside its window (2,000 a minute at ten minutes). */
  assert.equal(s.growth, Math.log10(1 + 2_000));
  assert.equal(s.first_read_age, Math.log10(1 + 10));
  assert.equal(s.attention, null, 'no attention read is missing, not zero');
});

test('★ a post never judged and never read is missing on every value, never zero', () => {
  const s = postSignals({ ...FACTS, coinable: null, confidence: null, lookedAt: null, proposedName: null, pictureSimilarity: null, readings: [], postedAtMs: null }, P);
  assert.equal(s.judge_unjudged, 1);
  assert.equal(s.judge_yes, 0);
  for (const k of ['judge_belief', 'picture', 'reach', 'growth', 'first_read_age', 'attention'] as const) assert.equal(s[k], null, k);
});

test("a \"no\" turns the judge's sureness around, and a held kind is its own indicator", () => {
  const s = postSignals({ ...FACTS, coinable: false, confidence: 0.9, kindLabel: 'AD' }, P);
  assert.ok(Math.abs((s.judge_belief ?? -1) - 0.1) < 1e-12);
  assert.equal(s.judge_held_kind, 1, 'AD is a held kind');
  assert.equal(postSignals({ ...FACTS, kindLabel: 'OTHER' }, P).judge_held_kind, 0);
});

test('a short video is read on its own scale, and readings past a For You age do not count', () => {
  const s = postSignals({ ...FACTS, reachScale: 10, readings: [...FACTS.readings, { atMs: POSTED + P.rising.fypMaxAgeMs + MIN, reach: 9_000_000 }] }, P);
  assert.equal(s.reach, Math.log10(1 + 5_000));
  /* a censored reading is not a level */
  assert.equal(postSignals({ ...FACTS, readings: [{ atMs: POSTED + MIN, reach: null }] }, P).reach, null);
});

test('★ the number reads a missing value through its missing term, and a value at the centre adds nothing', () => {
  const fit: ScoreFit = {
    intercept: 0,
    terms: [
      { signal: 'reach', kind: 'value', centre: 4, spread: 1, weight: 2 },
      { signal: 'reach', kind: 'missing', centre: 0, spread: 1, weight: -1 },
      { signal: 'unknown_signal', kind: 'value', centre: 0, spread: 1, weight: 5 },
    ],
  };
  assert.equal(postRankScore({ reach: 4 }, fit), 0.5);
  assert.equal(postRankScore({ reach: null }, fit), 1 / (1 + Math.exp(1)));
  assert.equal(postRankScore({ reach: 5 }, fit), 1 / (1 + Math.exp(-2)));
});
