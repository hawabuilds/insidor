/**
 * The first test in this repository, and the one that would have caught the bug the
 * whole rebuild is a response to.
 *
 * It asserts a negative: that a reading which taught us nothing publishes NO rate
 * rather than a zero. Everything else in this file exists to prove the rule did not
 * over-censor on its way to satisfying that.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { KineticsPolicy } from '@insidor/contracts/policy.ts';
import type { Counter, Fidelity } from '@insidor/contracts/vocabulary.ts';
import { toStoredRate } from '@insidor/contracts/vocabulary.ts';

import { emitRate } from './rate.ts';

/* A core test builds only the slice of Policy the unit under test reads. The frozen
   whole-system object lives in contracts and is exercised end to end in eval/. */
const KINETICS: KineticsPolicy = {
  fastTauMin: 20,
  slowTauMin: 360,
  stepSafetyFactor: 1,
  minElapsedMs: 30_000,
  nonMonotonicTolerance: 0.02,
};

const EXACT: Fidelity = { kind: 'exact' };
const ROUNDED_4: Fidelity = { kind: 'quantized', significantDigits: 4 };

const MINUTE = 60_000;

function reading(value: number | null, at: number, fidelity: Fidelity): Counter {
  return { value, fidelity, observedAt: at };
}

test('a change below the rounding step emits NO rate, never a zero', () => {
  // A source reporting four significant figures says 12,340 for anything in
  // [12,335, 12,345). A second reading of 12,340 five minutes later is consistent
  // with a true gain of a hundred a minute and with a true gain of nothing.
  const prev = reading(12_340, 0, ROUNDED_4);
  const curr = reading(12_340, 5 * MINUTE, ROUNDED_4);

  const rate = emitRate(prev, curr, false, KINETICS);

  assert.equal(rate.kind, 'censored');
  if (rate.kind !== 'censored') return;
  assert.equal(rate.reason, 'below_step');
  // The level survives the censoring even though the difference does not.
  assert.equal(rate.lastLevel, 12_340);
  // The whole point, stated the way the database will store it.
  assert.equal(toStoredRate(rate).ratePerMin, null);
});

test('a change of exactly one step is resolvable and is published', () => {
  const rate = emitRate(
    reading(12_340, 0, ROUNDED_4),
    reading(12_350, MINUTE, ROUNDED_4),
    false,
    KINETICS,
  );

  assert.equal(rate.kind, 'measured');
  if (rate.kind !== 'measured') return;
  assert.equal(rate.perMin, 10);
});

test('an exact counter that genuinely did not move publishes a real zero', () => {
  // This is the case the censoring rule must NOT swallow: an exact source saying
  // "still 40" is evidence, and suppressing it would hide a genuine plateau.
  const rate = emitRate(reading(40, 0, EXACT), reading(40, 4 * MINUTE, EXACT), false, KINETICS);

  assert.equal(rate.kind, 'measured');
  if (rate.kind !== 'measured') return;
  assert.equal(rate.perMin, 0);
});

test('an unmoved counter is censored as stale when a sibling counter rose', () => {
  const rate = emitRate(reading(40, 0, EXACT), reading(40, 4 * MINUTE, EXACT), true, KINETICS);

  assert.equal(rate.kind, 'censored');
  if (rate.kind !== 'censored') return;
  assert.equal(rate.reason, 'stale_counter');
});

test('a small backwards step is a wobble: censored, older level kept', () => {
  const rate = emitRate(reading(900, 0, EXACT), reading(890, MINUTE, EXACT), false, KINETICS);

  assert.equal(rate.kind, 'censored');
  if (rate.kind !== 'censored') return;
  assert.equal(rate.reason, 'non_monotonic');
  assert.equal(rate.lastLevel, 900);
});

test('a large backwards step is a restatement: censored, new level taken', () => {
  const rate = emitRate(reading(900, 0, EXACT), reading(400, MINUTE, EXACT), false, KINETICS);

  assert.equal(rate.kind, 'censored');
  if (rate.kind !== 'censored') return;
  assert.equal(rate.reason, 'non_monotonic');
  assert.equal(rate.lastLevel, 400);
});

test('the first reading of a counter has nothing to difference against', () => {
  const rate = emitRate(null, reading(120, MINUTE, EXACT), false, KINETICS);

  assert.equal(rate.kind, 'censored');
  if (rate.kind !== 'censored') return;
  assert.equal(rate.reason, 'no_prior');
  assert.equal(rate.lastLevel, 120);
});

test('a fuzzed or absent counter carries no level and no rate', () => {
  for (const fidelity of [{ kind: 'fuzzed' } as const, { kind: 'absent' } as const]) {
    const rate = emitRate(reading(10, 0, EXACT), reading(99, MINUTE, fidelity), false, KINETICS);

    assert.equal(rate.kind, 'censored');
    if (rate.kind !== 'censored') continue;
    assert.equal(rate.reason, 'unusable_fidelity');
    assert.equal(rate.lastLevel, null);
  }
});

test('two readings closer together than the floor produce no rate', () => {
  const rate = emitRate(reading(10, MINUTE, EXACT), reading(90, MINUTE, EXACT), false, KINETICS);

  assert.equal(rate.kind, 'censored');
  if (rate.kind !== 'censored') return;
  assert.equal(rate.reason, 'no_elapsed');
});

test('a measured rate is per minute over the interval actually elapsed', () => {
  const rate = emitRate(reading(100, 0, EXACT), reading(220, 2 * MINUTE, EXACT), false, KINETICS);

  assert.equal(rate.kind, 'measured');
  if (rate.kind !== 'measured') return;
  assert.equal(rate.perMin, 60);
  assert.equal(rate.overMs, 2 * MINUTE);
  assert.equal(rate.level, 220);
});
