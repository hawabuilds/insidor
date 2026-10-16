/** The views chart's rules (views-chart.ts): nothing invented, gaps stay gaps, bars only between neighbouring intervals, and the Per minute pill's span. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanTicks, perMinute, viewsPlan } from './views-chart.ts';

const M = 60_000;
const none = { found: null, coin: null };

test('no readings, no chart; the span runs from posting to now, never before the post', () => {
  assert.equal(viewsPlan([{ atMs: 5 * M, value: null }], 0, 10 * M, '1m', 'total', none), null);
  const plan = viewsPlan([{ atMs: 20 * M, value: 1_000 }], 5 * M, 60 * M, '1m', 'total', none);
  assert.ok(plan);
  assert.equal(plan.from, 5 * M);
  assert.equal(plan.to, 60 * M);
  assert.ok(plan.fromPosted);
  assert.deepEqual(plan.before?.from, { at: 5 * M, value: 0 }, 'the dashed part starts at 0 at posting');
  assert.deepEqual(plan.before?.to, { at: 20 * M, value: 1_000 }, 'and ends at our first counted reading');
  assert.equal(plan.before?.label, 'before we found it');
  const unknown = viewsPlan([{ atMs: 20 * M, value: 1_000 }], null, 60 * M, '1m', 'total', none);
  assert.equal(unknown?.from, 20 * M, 'an unknown post time starts at our first reading');
  assert.equal(unknown?.before, null, 'and draws no dashed part');
});

test('★ the total line breaks across a gap longer than 3x the expected spacing, and steps over a censored reading', () => {
  const r = [0, 2, 4, 6, 8, 30, 32].map((m) => ({ atMs: m * M, value: m * 100 }));
  const censored = [...r.slice(0, 3), { atMs: 5 * M, value: null }, ...r.slice(3)];
  const plan = viewsPlan(censored, 0, 33 * M, '1m', 'total', none);
  assert.ok(plan);
  assert.deepEqual(plan.runs.map((run) => run.map((p) => p.at / M)), [[0, 2, 4, 6, 8], [30, 32]], 'the 22-minute outage is a gap');
  const hourly = viewsPlan(r, 0, 33 * M, '1h', 'total', none);
  assert.deepEqual(hourly?.runs.map((run) => run.map((p) => p.at / M)), [[32]], 'one interval keeps its last reading, at its real time');
});

test('★ a bar is the gain since the last reading in the interval just before; anything further is missing, not piled on one bar', () => {
  const r = [{ atMs: 1 * M, value: 100 }, { atMs: 6 * M, value: 400 }, { atMs: 9 * M, value: 600 }, { atMs: 26 * M, value: 2_000 }, { atMs: 31 * M, value: 2_300 }];
  const plan = viewsPlan(r, 0, 35 * M, '5m', 'gained', none);
  assert.ok(plan);
  assert.deepEqual(plan.bars.map((b) => [b.start / M, b.gain, b.fromAt / M, b.toAt / M]), [[0, 100, 0, 1], [5, 500, 1, 9], [30, 300, 26, 31]], 'the first interval counts from 0 at posting');
  assert.equal(plan.bars.find((b) => b.start === 25 * M), undefined, 'the 9-to-26 jump spans empty intervals: no bar');
  const unposted = viewsPlan(r, null, 35 * M, '1D', 'gained', none);
  assert.deepEqual(unposted?.bars, [], 'no post time and one interval: nothing to subtract from');
  assert.equal(unposted?.noBars, 'Not enough readings yet for 1D bars');
  assert.equal(viewsPlan([{ atMs: 1 * M, value: 1 }, { atMs: 30 * M, value: 9 }], null, 35 * M, '1m', 'gained', none)?.noBars, 'Our readings are too far apart for 1m bars');
});

test('the y axis is clean steps from 0 past the highest value', () => {
  assert.deepEqual(cleanTicks(0, 196_116), [0, 100_000, 200_000]);
  assert.deepEqual(cleanTicks(0, 25_000), [0, 10_000, 20_000, 30_000]);
  assert.deepEqual(cleanTicks(-500, 2_000), [-1_000, 0, 1_000, 2_000]);
});

test('★ per minute is between the two newest readings at least a minute apart, and says its span', () => {
  const r = [{ atMs: 0, value: 1_000 }, { atMs: 9 * M, value: 28_900 }, { atMs: 9 * M + 20_000, value: 29_000 }];
  const now = 12 * M;
  const p = perMinute(r, now);
  assert.ok(p);
  assert.equal(p.text, '+3K/min', '28K over 9m20s: the reading 20s before the newest is too close');
  assert.equal(p.over, 'last 9m');
  assert.match(perMinute(r, 60 * M)?.over ?? '', /^9m to \d\d:\d\d$/, 'an old span says when it ended');
  assert.equal(perMinute([{ atMs: 0, value: 1 }, { atMs: 30_000, value: 2 }], M), null, 'under a minute apart says nothing');
});
