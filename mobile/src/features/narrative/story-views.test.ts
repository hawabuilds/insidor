/** A narrative's total views (story-views.ts): summed only where every post is known, carried only within its gap. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { viewsPlan } from '../post-sheet/views-chart.ts';
import { gainedLastHour, latestTotal, storyTotal } from './story-views.ts';

const M = 60_000;
const every5 = (from: number, to: number, start: number, perMin: number) => {
  const out = [];
  for (let t = from; t <= to; t += 5 * M) out.push({ atMs: t, value: start + ((t - from) / M) * perMin });
  return out;
};

test('★ two posts read together: the total is their sum at each reading, and a post not yet up counts as a known 0', () => {
  const a = { id: 'a', postedAt: 0, readings: every5(5 * M, 60 * M, 100, 10) };
  const b = { id: 'b', postedAt: 30 * M, readings: every5(35 * M, 60 * M, 50, 1) };
  const t = storyTotal([a, b], 60 * M);
  const at = (ms: number) => t.points.find((p) => p.atMs === ms)?.value;
  assert.equal(at(10 * M), 150, 'b is not up yet: a alone');
  assert.equal(at(35 * M), 400 + 50);
  assert.equal(t.unknownNow, 0);
});

test('★ between a post going up and its first reading the total is not drawn', () => {
  const a = { id: 'a', postedAt: 0, readings: every5(5 * M, 60 * M, 100, 10) };
  const b = { id: 'b', postedAt: 30 * M, readings: every5(42 * M, 60 * M, 50, 1) };
  const t = storyTotal([a, b], 60 * M);
  assert.ok(t.breaks.includes(30 * M) && t.breaks.includes(35 * M) && t.breaks.includes(40 * M));
  assert.equal(t.points.find((p) => p.atMs === 35 * M), undefined);
});

test('★ a post we stopped reading is unknown once its gap passes: never carried flat, never zero', () => {
  const a = { id: 'a', postedAt: 0, readings: every5(5 * M, 120 * M, 100, 10) };
  const b = { id: 'b', postedAt: 0, readings: every5(5 * M, 40 * M, 10, 1) };
  const t = storyTotal([a, b], 120 * M);
  assert.ok(t.points.some((p) => p.atMs === 45 * M), 'one spacing late is still within the gap (1.5x)');
  assert.ok(!t.points.some((p) => p.atMs === 50 * M), 'two spacings late is not');
  assert.equal(t.unknownNow, 1);
  assert.deepEqual(gainedLastHour(t, 120 * M), { kind: 'unknown', why: 'Not every post has a recent view reading' });
});

test('a post with no readings at all, posted at an unknown time, makes every total unknown', () => {
  const a = { id: 'a', postedAt: 0, readings: every5(5 * M, 60 * M, 100, 10) };
  const t = storyTotal([a, { id: 'b', postedAt: null, readings: [] }], 60 * M);
  assert.deepEqual(t.points, []);
  assert.equal(t.neverRead, 1);
});

test('a rounded-away reading is not a value', () => {
  const t = storyTotal([{ id: 'a', postedAt: 0, readings: [{ atMs: 5 * M, value: null }] }], 10 * M);
  assert.deepEqual(t.points, []);
});

test('★ the header total adds every post\'s latest reading, and a post never read makes it unknown, not smaller', () => {
  assert.deepEqual(latestTotal([{ latest: 1_400_000, latestAt: 5 }, { latest: 1_100_000, latestAt: 3 }]), { kind: 'value', total: 2_500_000, oldestAt: 3 });
  assert.deepEqual(latestTotal([{ latest: 10, latestAt: 5 }, { latest: null, latestAt: null }]), { kind: 'unknown', why: '1 post has no view reading' });
});

test('gained in the last hour: the newest total against the one nearest an hour before, with its real span', () => {
  const a = { id: 'a', postedAt: 0, readings: every5(5 * M, 120 * M, 100, 10) };
  const g = gainedLastHour(storyTotal([a], 121 * M), 121 * M);
  assert.deepEqual(g, { kind: 'value', gain: 600, minutes: 60 });
});

test('★ the chart breaks across the narrative\'s breaks and no bar spans one', () => {
  const a = { id: 'a', postedAt: 0, readings: every5(5 * M, 60 * M, 100, 10) };
  const b = { id: 'b', postedAt: 0, readings: [...every5(5 * M, 20 * M, 10, 1), ...every5(40 * M, 60 * M, 50, 1)] };
  const t = storyTotal([a, b], 60 * M);
  const plan = viewsPlan(t.points, 0, 60 * M, '5m', 'total', { found: null, coin: null }, { breaks: t.breaks, beforeLabel: 'before every post was read' });
  assert.ok(plan);
  assert.equal(plan.runs.length, 2, 'one run before the stretch b was not read, one after');
  const gained = viewsPlan(t.points, 0, 60 * M, '5m', 'gained', { found: null, coin: null }, { breaks: t.breaks });
  assert.ok(gained?.bars.every((bar) => !t.breaks.some((x) => x > bar.fromAt && x < bar.toAt)));
  assert.equal(plan.before?.label, 'before every post was read');
});
