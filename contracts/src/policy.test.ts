/**
 * A policy edited mid-run makes its own hash a lie, and a lie in the audit column is
 * worse than having no audit column. So the freeze is tested at every depth, not just
 * at the top level.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from './policy.ts';

test('the policy is frozen all the way down', () => {
  const seen = new Set<object>();

  const walk = (value: unknown, path: string): void => {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    assert.ok(Object.isFrozen(value), `not frozen: ${path}`);
    for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
  };

  walk(DEFAULT_POLICY, 'policy');
});

test('no scorer is loaded on day one, so every stage falls back to its rule', () => {
  for (const [stage, scorer] of Object.entries(DEFAULT_POLICY.scorers)) {
    assert.equal(scorer, null, `${stage} must start as a rule`);
  }
});

test('the ambiguity margin is non-zero, or "no confident match" is unenforceable', () => {
  assert.ok(DEFAULT_POLICY.resolve.deltaMargin > 0);
  assert.ok(DEFAULT_POLICY.resolve.tauHigh > 0 && DEFAULT_POLICY.resolve.tauHigh < 1);
});

test('the holdout is not zero — it is the only unbiased history in the system', () => {
  assert.ok(DEFAULT_POLICY.explore.holdoutRate > 0);
});

/**
 * This used to assert that `track.holdoutRate` equalled `explore.holdoutRate`, which
 * is the shape of test you write when two fields hold one number. The repair was to
 * delete the field nothing read rather than to keep testing that the copy agreed, so
 * what is asserted now is that the copy is gone: a second holdout rate would be found
 * first by whoever tunes the lane, changed, and would silently do nothing.
 */
test('there is exactly one holdout rate, and it is the one every call site reads', () => {
  assert.ok(!Object.hasOwn(DEFAULT_POLICY.track, 'holdoutRate'));
});

test('the tracking grid is strictly increasing, so a tier is always a longer wait', () => {
  const tiers = DEFAULT_POLICY.track.tierMinutes;
  for (let i = 1; i < tiers.length; i += 1) {
    assert.ok((tiers[i] ?? 0) > (tiers[i - 1] ?? 0), `tier ${i} is not longer than ${i - 1}`);
  }
  assert.equal(tiers.length, DEFAULT_POLICY.track.tierCutoffs.length + 1);
});

test('the age ladder is one step per tier boundary and strictly ascending', () => {
  const ages = DEFAULT_POLICY.track.ageTierMinutes;
  assert.equal(ages.length, DEFAULT_POLICY.track.tierMinutes.length - 1);
  for (let i = 1; i < ages.length; i += 1) assert.ok((ages[i] ?? 0) > (ages[i - 1] ?? 0));
});

test('the account watch asks its 40 most coined accounts every 6 minutes, on a $2.40 day', () => {
  const w = DEFAULT_POLICY.feed.accountWatch;
  assert.equal(w.maxAccounts, 40);
  assert.equal(w.everyMs, 360_000);
  assert.equal(w.cap.dailyUsd, 2.4);
  assert.ok(w.maxWindowMs >= w.everyMs, 'a pass after a restart must reach back at least one cadence');
});

test('re-reads may take $5 of the search day and no more than the day, and reply reads are off', () => {
  const day = DEFAULT_POLICY.feed.searchDay;
  assert.equal(day.rereadDailyUsd, 5);
  assert.ok(day.rereadDailyUsd <= day.dailyUsd, 're-reads are a part of the day, not beside it');
  assert.equal(DEFAULT_POLICY.attention.postsPerDay, 0);
});

test('★ the next post space carries a bar for every post-space bar, each naming one that exists', () => {
  /* policy.v180: the switch copies these over the bars they name; a key that names nothing, or a
     post-space bar left without a key, would switch with a bar measured for the other space. */
  const POST_SPACE_BARS = [
    'narrative.same.meaning', 'narrative.sameMeaning', 'narrative.mergeMeaning', 'narrative.nameMeaning',
    'narrative.origin.mergeMeaning', 'narrative.origin.nameAverage', 'narrative.origin.phraseMeaning', 'narrative.origin.wordsMeaning',
    'narrative.origin.linkMeaning', 'narrative.origin.looseWordsMeaning', 'narrative.origin.rootMeaning',
    'postCoin.storyCoin.alone', 'postCoin.storyCoin.together', 'postCoin.storyCoin.near',
    'rising.varietySameMeaning', 'judge.precedents.holdNotSimilarity',
  ];
  const image = DEFAULT_POLICY.group.image;
  assert.ok(image.postSpaceNext !== null && image.postSpaceNext !== image.postSpace);
  const bars = image.postSpaceNextBars;
  assert.ok(bars !== null);
  assert.deepEqual(Object.keys(bars).sort(), [...POST_SPACE_BARS].sort());
  for (const [path, value] of Object.entries(bars)) {
    const now = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], DEFAULT_POLICY);
    assert.equal(typeof now, 'number', `${path} names no bar`);
    assert.ok(value > 0 && value < 1, `${path}: ${value}`);
  }
  /* The tiers keep their order in the new space, as in the old. */
  const b = (k: string): number => bars[k] ?? NaN;
  assert.ok(b('narrative.same.meaning') >= b('narrative.sameMeaning') && b('narrative.sameMeaning') >= b('narrative.nameMeaning'));
  assert.ok(b('narrative.nameMeaning') >= b('narrative.origin.linkMeaning') && b('narrative.origin.linkMeaning') >= b('narrative.origin.looseWordsMeaning'));
  assert.ok(b('narrative.origin.looseWordsMeaning') >= b('narrative.origin.rootMeaning'));
});
