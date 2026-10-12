/** Paced lines: a line may spend only its share of the day so far, plus the head start. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { inMemoryMeter } from './in-memory.ts';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIDNIGHT = 20_000 * DAY;

function meterAt(at: number) {
  return inMemoryMeter({ dailyCapUsd: 24, perVendorCapUsd: { posts: 12 }, softStop: 1, paceAheadMs: HOUR, now: () => at });
}

test('★ at midnight a line may spend only its head start: one hour of a day', () => {
  const m = meterAt(MIDNIGHT);
  assert.equal(m.mayspend('posts', 0.5), true, '12 × 1/24 = 0.50');
  assert.equal(m.mayspend('posts', 0.51), false);
});

test('at noon half the line plus the head start is open', () => {
  const m = meterAt(MIDNIGHT + 12 * HOUR);
  assert.equal(m.mayspend('posts', 6.5), true, '12 × 13/24 = 6.50');
  assert.equal(m.mayspend('posts', 6.6), false);
});

test('the total is paced as well as each vendor', () => {
  const m = meterAt(MIDNIGHT);
  assert.equal(m.mayspend('other', 1), true, '24 × 1/24 = 1.00');
  assert.equal(m.mayspend('other', 1.01), false);
});

test('the line reports what may be spent now, not what may be spent by midnight', () => {
  const line = meterAt(MIDNIGHT + 12 * HOUR).line('posts');
  assert.equal(line.capUsd, 12);
  assert.ok(Math.abs(line.remainingUsd - 6.5) < 1e-9);
});

test('unpaced, the whole line is open at any hour', () => {
  const m = inMemoryMeter({ dailyCapUsd: 24, perVendorCapUsd: { posts: 12 }, softStop: 1, now: () => MIDNIGHT });
  assert.equal(m.mayspend('posts', 12), true);
});
