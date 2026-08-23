/**
 * Backoff, asserted at exact numbers rather than in ranges.
 *
 * That is only possible because `backoffDelayMs` takes its randomness as an argument. The
 * tests pin both ends of the equal-jitter band by passing 0 and ~1, so the width of the
 * band is a fact here and not a statistical hope. The day someone reaches for
 * `Math.random()` inside backoff.ts, every assertion below has to soften into a range and
 * stops holding the property it was written for — that injected `random` parameter is not
 * a purity gesture, it is what makes this file possible.
 *
 * The three failures being held:
 *
 *   - A RETRY THAT IS INSTANT. `lower > 0` is asserted at the smallest jitter, not implied.
 *     The failure this watcher actually meets is a rate limit rather than a hard outage,
 *     and a near-zero retry against a rate limit is how a throttle becomes a ban. This is
 *     the assertion that would disappear first if the jitter scheme were changed to full
 *     jitter, which is the alternative backoff.ts explains it rejected.
 *   - A DELAY THAT STOPS BEING A NUMBER. attempt 2,000 is asserted finite. Without the
 *     exponent cap, `2 ** attempt` reaches Infinity, the ceiling arithmetic yields NaN, and
 *     a NaN handed to a timer is coerced to zero — so the overflow does not show up as a
 *     crash, it shows up as the instant retry above, during exactly the long outage where
 *     the delay mattered most.
 *   - A HEALTHY CALLER BEING SLOWED. attempt 0 and negative attempts return 0. "Not
 *     failing" is not a backoff situation, and a base delay applied to a working loop is a
 *     permanent tax nobody would think to look for.
 */

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
