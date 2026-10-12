/**
 * A re-read becomes one observation per counter, with a rate only where two readings allow one.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { itemId, sourceId } from '@insidor/contracts/ids.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Counter, Millis, Observation } from '@insidor/contracts/vocabulary.ts';

import { latestCounters, observationsFrom } from './readings.ts';

const ITEM = itemId(sourceId('feed-a'), 'p1');
const T0 = 1_700_000_000_000 as Millis;
const MINUTE = 60_000;
const exact = (value: number, at: number): Counter => ({ value, fidelity: { kind: 'exact' }, observedAt: at as Millis });

test('a first reading has levels and no rate', () => {
  const out = observationsFrom(ITEM, { reach: exact(1_000, T0) }, {}, T0, DEFAULT_POLICY.kinetics);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.rate.kind, 'censored');
});

test('★ a second reading gives a rate per minute against the previous level', () => {
  const at = T0 + 5 * MINUTE;
  const out = observationsFrom(ITEM, { reach: exact(1_500, at) }, { reach: exact(1_000, T0) }, at as Millis, DEFAULT_POLICY.kinetics);
  const rate = out[0]?.rate;
  assert.equal(rate?.kind, 'measured');
  assert.equal(rate?.kind === 'measured' ? rate.perMin : null, 100);
});

test('a flat counter while a sibling rose is a stale counter, not a quiet post', () => {
  const at = T0 + 5 * MINUTE;
  const out = observationsFrom(
    ITEM,
    { reach: exact(1_000, at), approval: exact(80, at) },
    { reach: exact(1_000, T0), approval: exact(50, T0) },
    at as Millis,
    DEFAULT_POLICY.kinetics,
  );
  const reach = out.find((o) => o.kind === 'reach');
  assert.equal(reach?.rate.kind === 'censored' ? reach.rate.reason : null, 'stale_counter');
});

test('latestCounters keeps the newest reading of each counter', () => {
  const series: Observation[] = [
    { itemId: ITEM, capturedAt: (T0 + MINUTE) as Millis, kind: 'reach', counter: exact(20, T0 + MINUTE), rate: { kind: 'censored', reason: 'no_prior', lastLevel: 20 } },
    { itemId: ITEM, capturedAt: T0, kind: 'reach', counter: exact(10, T0), rate: { kind: 'censored', reason: 'no_prior', lastLevel: 10 } },
  ];
  assert.equal(latestCounters(series).reach?.value, 20);
});
