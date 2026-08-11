/**
 * The first tests in the repository, and they are about the censored branch on
 * purpose: the bug they stand against shipped a `0` where the honest answer was
 * "we learned nothing", and a zero downstream reads as cooling, which demotes
 * exactly the items that are accelerating.
 *
 * The compile-time half of this guarantee cannot be asserted at runtime — reading
 * `.perMin` off the censored branch is a typecheck error, which is the real
 * protection. These tests pin the runtime half: the flattening never invents a zero.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { censoredRate, measuredRate, toStoredRate } from './vocabulary.ts';
import type { Rate } from './vocabulary.ts';

test('a censored rate flattens to null, never to zero', () => {
  const rate = censoredRate('below_step', 1200);
  const stored = toStoredRate(rate);

  assert.equal(stored.ratePerMin, null);
  assert.equal(stored.censored, 'below_step');
  assert.notEqual(stored.ratePerMin, 0);
});

test('a censored rate still carries the last trustworthy level forward', () => {
  const rate = censoredRate('stale_counter', 4096);
  assert.equal(rate.kind === 'censored' ? rate.lastLevel : null, 4096);
});

test('a measured rate keeps the interval it was differenced over', () => {
  const rate = measuredRate(2.5, 120_000, 900);
  assert.equal(rate.kind, 'measured');
  assert.equal(rate.kind === 'measured' ? rate.overMs : null, 120_000);
});

test('every consumer must branch: there is no third state', () => {
  const rates: readonly Rate[] = [
    measuredRate(1, 60_000, 10),
    censoredRate('no_prior', null),
  ];

  // The default arm exists only to prove the union is closed — adding a variant
  // without handling it here would fail the exhaustiveness check above it.
  for (const rate of rates) {
    switch (rate.kind) {
      case 'measured':
        assert.ok(Number.isFinite(rate.perMin));
        break;
      case 'censored':
        assert.ok(rate.reason.length > 0);
        break;
      default: {
        const impossible: never = rate;
        assert.fail(`unhandled rate variant: ${String(impossible)}`);
      }
    }
  }
});
