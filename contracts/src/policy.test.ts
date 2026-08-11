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
  assert.ok(DEFAULT_POLICY.track.holdoutRate > 0);
  assert.equal(DEFAULT_POLICY.track.holdoutRate, DEFAULT_POLICY.explore.holdoutRate);
});

test('the tracking grid is strictly increasing, so a tier is always a longer wait', () => {
  const tiers = DEFAULT_POLICY.track.tierMinutes;
  for (let i = 1; i < tiers.length; i += 1) {
    assert.ok((tiers[i] ?? 0) > (tiers[i - 1] ?? 0), `tier ${i} is not longer than ${i - 1}`);
  }
  assert.equal(tiers.length, DEFAULT_POLICY.track.tierCutoffs.length + 1);
});
