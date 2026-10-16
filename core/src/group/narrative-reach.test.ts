/**
 * A narrative's views (narrative.ts `narrativeReach`), the owner's rule of 2026-10-17: each post's
 * gain from its own readings, spread evenly between two readings, nothing before its first reading
 * or after its last, then added up. A late-found post makes no spike; a sparse post's jump is a slope.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { narrativeReach } from './narrative.ts';

const P = DEFAULT_POLICY;
const MIN = 60_000;
const STEP = P.narrative.reach.stepMs;
const NOW = 100 * 60 * MIN;
const every = (from: number, to: number, step: number, start: number, perStep: number) => {
  const out = [];
  for (let t = from, v = start; t <= to; t += step, v += perStep) out.push({ atMs: t, reach: v });
  return out;
};
const slotAt = (r: ReturnType<typeof narrativeReach>, t: number) => r.gained.values[Math.floor((t - r.gained.fromMs) / r.gained.stepMs)];

test('★ two posts read all day: the hour gained is both posts, the total their newest counts', () => {
  const a = { postedAtMs: NOW - 30 * 60 * MIN, points: every(NOW - 30 * 60 * MIN, NOW, 5 * MIN, 0, 100) };
  const b = { postedAtMs: NOW - 30 * 60 * MIN, points: every(NOW - 30 * 60 * MIN, NOW, 5 * MIN, 0, 10) };
  const r = narrativeReach([a, b], NOW, P);
  assert.deepEqual(r.lastHour, { value: 12 * 110, counted: 2, of: 2 });
  assert.equal(r.total.value, (a.points.at(-1)?.reach ?? 0) + (b.points.at(-1)?.reach ?? 0));
  assert.ok(r.gained.values.every((v) => v === (110 * STEP) / (5 * MIN)));
});

test('★ a post found late with a million views adds no spike: its gain counts from its first reading', () => {
  const steady = { postedAtMs: NOW - 5 * 60 * MIN, points: every(NOW - 5 * 60 * MIN, NOW, 5 * MIN, 0, 1_000) };
  const late = { postedAtMs: NOW - 10 * 60 * MIN, points: every(NOW - 2 * 60 * MIN, NOW, 5 * MIN, 1_000_000, 1_000) };
  const r = narrativeReach([steady, late], NOW, P);
  const max = Math.max(...r.gained.values.map((v) => v ?? 0));
  assert.equal(max, (2_000 * STEP) / (5 * MIN), 'the slot it was found in holds its gain since then, not its million');
  assert.equal(slotAt(r, NOW - 3 * 60 * MIN), (1_000 * STEP) / (5 * MIN), 'before we read it, it adds nothing');
  assert.equal(r.total.value, (steady.points.at(-1)?.reach ?? 0) + (late.points.at(-1)?.reach ?? 0));
});

test('★ a gain between two far-apart readings is spread evenly over the time between them', () => {
  const sparse = { postedAtMs: NOW - 3 * 60 * MIN, points: [{ atMs: NOW - 2 * 60 * MIN, reach: 0 }, { atMs: NOW, reach: 120_000 }] };
  const r = narrativeReach([sparse], NOW, P);
  const per = (120_000 * STEP) / (120 * MIN);
  assert.ok(r.gained.values.every((v) => v === per), 'every slot of the two hours has its share');
  assert.equal(r.lastHour.value, 60_000);
});

test('★ after its last reading a post adds nothing; a slot nobody read is null, never zero', () => {
  const stopped = { postedAtMs: NOW - 20 * 60 * MIN, points: every(NOW - 20 * 60 * MIN, NOW - 10 * 60 * MIN, 5 * MIN, 0, 50) };
  const r = narrativeReach([stopped], NOW, P);
  assert.equal(slotAt(r, NOW - 5 * 60 * MIN), null, 'no post was being read then');
  assert.equal(r.lastHour.value, null, 'nothing was read in the last hour');
  assert.equal(r.gained.values.at(-1), null);
  assert.equal(r.gained.fromMs, NOW - 20 * 60 * MIN, 'the series starts at the first slot anything was read in');
});

test('a post with no reading is counted out, and said', () => {
  const read = { postedAtMs: NOW - 60 * MIN, points: every(NOW - 60 * MIN, NOW, 5 * MIN, 0, 10) };
  const never = { postedAtMs: NOW - 60 * MIN, points: [] };
  const r = narrativeReach([read, never], NOW, P);
  assert.deepEqual(r.total, { value: 120, counted: 1, of: 2 });
  assert.deepEqual(r.posts[1], { total: null, lastHour: null });
  assert.deepEqual(narrativeReach([{ postedAtMs: null, points: [] }], NOW, P).total, { value: null, counted: 0, of: 1 });
});

test('a lower count than the one before adds nothing rather than taking views away', () => {
  const r = narrativeReach([{ postedAtMs: null, points: [{ atMs: NOW - 20 * MIN, reach: 500 }, { atMs: NOW - 10 * MIN, reach: 400 }, { atMs: NOW, reach: 600 }] }], NOW, P);
  assert.equal(r.lastHour.value, 200);
});
