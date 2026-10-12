/**
 * The catch-all floor: what is sent, what each lane aims at, and how a pass moves it.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { effectiveFloor, laneTargets, nextFloor, startFloors } from './feed-floor.ts';

const P = DEFAULT_POLICY;

test('a 30-minute window sends half the base floor, and never less than the effective minimum', () => {
  assert.equal(effectiveFloor(1_000, P), 500);
  assert.equal(effectiveFloor(100, P), 50);
  assert.equal(effectiveFloor(10, P), 50, 'a base below the minimum is lifted to it first');
  assert.equal(effectiveFloor(10_000_000, P), P.feed.floorMax * 0.5);
});

test('★ the targets spend the catch-all share of the day and split a quarter to media', () => {
  // $1 a day, $0.00015 a post, a pass every five minutes.
  const t = laneTargets(1, 0.00015, 288, P);
  const perPass = (1 * P.feed.budgetShare) / 0.00015 / 288;
  assert.ok(Math.abs(t.all + t.media - perPass) < 1e-9);
  assert.ok(Math.abs(t.media / perPass - P.feed.mediaShare) < 1e-9);
  assert.ok(Math.abs((t.all + t.media) * 288 * 0.00015 - P.feed.budgetShare) < 1e-9, 'a day at target is the share, exactly');
});

test('a free source or no passes has no target rather than an infinite one', () => {
  assert.deepEqual(laneTargets(1, 0, 288, P), { all: 0, media: 0 });
});

test('★ a lane that returned nothing lowers its floor by 40% at once, never below the minimum', () => {
  assert.deepEqual(nextFloor(1_000, 0, 10, false, P), { floor: 600, move: 'empty' });
  assert.equal(nextFloor(120, 0, 10, false, P).floor, P.feed.floorMin);
});

test('over target raises 20%; under 60% of target lowers 20%; in between holds', () => {
  assert.deepEqual(nextFloor(1_000, 20, 10, false, P), { floor: 1_200, move: 'raised' });
  assert.deepEqual(nextFloor(1_000, 5, 10, false, P), { floor: 800, move: 'lowered' });
  assert.deepEqual(nextFloor(1_000, 8, 10, false, P), { floor: 1_000, move: 'held' });
});

test('★ no lane is raised while the other one is starving', () => {
  assert.deepEqual(nextFloor(1_000, 20, 10, true, P), { floor: 1_000, move: 'held_other_lane_empty' });
});

test('the floors never pass the ceiling', () => {
  assert.equal(nextFloor(P.feed.floorMax, 99, 1, false, P).floor, P.feed.floorMax);
});

test('both lanes start where policy says', () => {
  assert.deepEqual(startFloors(P), { all: P.feed.startFloor, media: P.feed.mediaStartFloor });
});
