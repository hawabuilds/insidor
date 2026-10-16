/**
 * A narrative's views (narrative.ts `narrativeReach`): summed only where every post is known, a post
 * not yet up a true zero, a stale post unknown rather than flat, and the counts of posts behind the
 * total and the last hour's gain.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { narrativeReach } from './narrative.ts';

const P = DEFAULT_POLICY;
const MIN = 60_000;
const NOW = 100 * 60 * MIN;
const every = (from: number, to: number, step: number, start: number, perStep: number) => {
  const out = [];
  for (let t = from, v = start; t <= to; t += step, v += perStep) out.push({ atMs: t, reach: v });
  return out;
};

test('★ two posts read all day: the sum is known everywhere, and the hour gained is both posts', () => {
  const a = { postedAtMs: NOW - 30 * 60 * MIN, points: every(NOW - 30 * 60 * MIN, NOW, 5 * MIN, 0, 100) };
  const b = { postedAtMs: NOW - 30 * 60 * MIN, points: every(NOW - 30 * 60 * MIN, NOW, 5 * MIN, 0, 10) };
  const r = narrativeReach([a, b], NOW, P);
  assert.ok(r.series.every((x) => x.value !== null));
  assert.deepEqual(r.gained, { value: 12 * 110, counted: 2, of: 2 });
  assert.equal(r.total.value, (a.points.at(-1)?.reach ?? 0) + (b.points.at(-1)?.reach ?? 0));
});

test('★ a post not yet up is a true zero; a post no longer read is unknown, and the line breaks', () => {
  const late = { postedAtMs: NOW - 30 * MIN, points: every(NOW - 30 * MIN, NOW, 5 * MIN, 0, 1_000) };
  const stale = { postedAtMs: NOW - 20 * 60 * MIN, points: every(NOW - 20 * 60 * MIN, NOW - 10 * 60 * MIN, 5 * MIN, 0, 50) };
  const r = narrativeReach([late, stale], NOW, P);
  assert.equal(r.series.at(-1)?.value, null, 'the stale post is unknown now');
  assert.equal(r.gained.counted, 1, 'only the late post is known at both ends of the hour');
  assert.equal(r.gained.value, 6_000);
  assert.equal(r.total.counted, 2);
  assert.deepEqual(narrativeReach([{ postedAtMs: null, points: [] }], NOW, P).total, { value: null, counted: 0, of: 1 });
});
