/**
 * GROUP is not built yet. One of these is already implemented and tested through
 * persistence.ts; the rest are the claims the join has to satisfy.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { carrierWeight, persistence } from './persistence.ts';

test('a term present in almost every bucket is weighted to nothing', () => {
  const alwaysThere = new Array<number>(14).fill(40);
  assert.equal(persistence(alwaysThere, DEFAULT_POLICY), 1);
  assert.equal(carrierWeight('hipposeason', 5, alwaysThere, DEFAULT_POLICY), 0);
});

test('a term that spiked in the last two buckets keeps almost all its weight', () => {
  // The case raw document frequency gets backwards: high df today, absent all week.
  const brandNew = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 80, 120];
  const w = carrierWeight('hipposeason', 5, brandNew, DEFAULT_POLICY);

  assert.ok(w > 4, `expected nearly full weight, got ${w}`);
});

test('a generic symbol is worth zero whatever its frequency', () => {
  assert.equal(carrierWeight('$SOL', 9, [0, 0, 1], DEFAULT_POLICY), 0);
});

test('an item sharing an exact carrier joins with no model call', { todo: 'group/carriers.ts' });

test('a representation outage degrades grouping to the free tiers, never stops it', {
  todo: 'group/stage.ts',
});

test('two candidates inside the adjudication band go to a human, not to a guess', {
  todo: 'group/match.ts',
});

test('a merge always folds into the older story, so earliestPostAt cannot move forward', {
  todo: 'group/merge.ts',
});
