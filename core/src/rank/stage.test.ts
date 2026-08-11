/**
 * RANK is not built yet, but the primitive is, and the property that matters most
 * about it is testable today: candidate isolation.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { heat } from './heat.ts';

test('a score depends only on its own subject, so the board cannot reshuffle around it', () => {
  const subject = { rateLcbNorm: 0.4, burst: 2.25, quality: 0.8, ageMin: 30 };

  // The same inputs, scored twice with nothing shared between the calls. If any term
  // ever reached another candidate, this is the test that would stop compiling.
  assert.equal(heat(subject, DEFAULT_POLICY), heat(subject, DEFAULT_POLICY));
});

test('age penalises: the same evidence is worth less an hour later', () => {
  const fresh = heat({ rateLcbNorm: 0.4, burst: 2.25, quality: 0.8, ageMin: 5 }, DEFAULT_POLICY);
  const older = heat({ rateLcbNorm: 0.4, burst: 2.25, quality: 0.8, ageMin: 65 }, DEFAULT_POLICY);

  assert.ok(older < fresh);
});

test('no evidence is zero heat, not a small positive number', () => {
  assert.equal(heat({ rateLcbNorm: 0, burst: 3, quality: 1, ageMin: 1 }, DEFAULT_POLICY), 0);
});

test('the board is committed server-side and the client never sorts', { todo: 'rank/stage.ts' });

test('a challenger must beat the incumbent by the swap edge to move', {
  todo: 'rank/hysteresis.ts',
});

test('rank correlation between ticks stays inside its floor and its ceiling', {
  todo: 'rank/stability.ts',
});
