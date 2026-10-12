/** The earlier build's 20% / 40% / 40% split by view rate, with no rate meaning no rank. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { rankByVelocity } from './velocity.ts';

test('★ the fastest fifth is hot, the next two fifths warm, the rest cold', () => {
  const rates = [10, 90, 50, 70, 30, 80, 20, 60, 40, 100];
  const ranks = rankByVelocity(rates, DEFAULT_POLICY);
  assert.deepEqual(rates.map((r, i) => [r, ranks[i]]).sort((a, b) => Number(b[0]) - Number(a[0])).map((x) => x[1]), [
    'hot', 'hot', 'warm', 'warm', 'warm', 'warm', 'cold', 'cold', 'cold', 'cold',
  ]);
});

test('★ a post with no rate yet has no rank, rather than the slowest one', () => {
  assert.deepEqual(rankByVelocity([null, 5], DEFAULT_POLICY), [null, 'hot']);
});

test('one ranked post is hot; none is nothing', () => {
  assert.deepEqual(rankByVelocity([3], DEFAULT_POLICY), ['hot']);
  assert.deepEqual(rankByVelocity([], DEFAULT_POLICY), []);
});
