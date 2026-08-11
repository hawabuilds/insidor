import test from 'node:test';
import assert from 'node:assert/strict';

import { backoffDelayMs, type BackoffOptions } from './backoff.ts';

const opts: BackoffOptions = { baseMs: 1_000, maxMs: 60_000 };

test('a healthy caller is not delayed', () => {
  assert.equal(backoffDelayMs(0, opts, 0.5), 0);
  assert.equal(backoffDelayMs(-3, opts, 0.5), 0);
});

test('the delay doubles per consecutive failure', () => {
  // random = 0 gives the lower bound of the equal-jitter band: half the ceiling.
  assert.equal(backoffDelayMs(1, opts, 0), 500);
  assert.equal(backoffDelayMs(2, opts, 0), 1_000);
  assert.equal(backoffDelayMs(3, opts, 0), 2_000);
});

test('jitter spreads the retry without ever making it immediate', () => {
  const lower = backoffDelayMs(4, opts, 0);
  const upper = backoffDelayMs(4, opts, 0.999);
  assert.equal(lower, 4_000);
  assert.ok(upper > lower && upper <= 8_000);
  assert.ok(lower > 0, 'a retry is never instant, even at the smallest jitter');
});

test('the ceiling holds through a long outage', () => {
  assert.equal(backoffDelayMs(50, opts, 0), 30_000);
  assert.equal(backoffDelayMs(500, opts, 1), 60_000);
  assert.ok(Number.isFinite(backoffDelayMs(2_000, opts, 0.5)), 'no overflow into NaN');
});
