/**
 * The "You'd be first" rule: a sighting is always `taken`, and finding nothing is only
 * `unseen` when we were watching.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { tickerUse } from './ticker.ts';

const LOOKBACK = DEFAULT_POLICY.assets.tickerLookbackMs;
const covered = (share: number): Millis => Math.round(LOOKBACK * share) as Millis;

test('one launch under the ticker is taken, with the count', () => {
  assert.deepEqual(tickerUse({ launches: 3, coveredMs: covered(1) }, DEFAULT_POLICY), { kind: 'taken', launches: 3 });
});

test('a sighting is taken even when our watch had gaps: what we saw happened', () => {
  assert.equal(tickerUse({ launches: 1, coveredMs: covered(0) }, DEFAULT_POLICY).kind, 'taken');
});

test("nothing seen across a fully watched lookback is unseen, which is what lets the screen say you'd be first", () => {
  assert.deepEqual(tickerUse({ launches: 0, coveredMs: covered(1) }, DEFAULT_POLICY), { kind: 'unseen' });
});

test('★ nothing seen while we were not watching is unknown, never first', () => {
  const short = DEFAULT_POLICY.assets.tickerMinCoverage - 0.01;
  assert.deepEqual(tickerUse({ launches: 0, coveredMs: covered(short) }, DEFAULT_POLICY), { kind: 'unknown' });
  assert.deepEqual(tickerUse({ launches: 0, coveredMs: covered(0) }, DEFAULT_POLICY), { kind: 'unknown' });
});
