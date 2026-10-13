/**
 * The catch-all floor: what is sent, what each lane aims at, and how a pass moves it.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { bandFloor, bandWindow, effectiveFloor, laneTargets, nextFloor, sentFloors, sliceCoveredByBands, slowLaneDue, startFloors } from './feed-floor.ts';

const P = DEFAULT_POLICY;

const at = (all: number, slow = all): { all: number; media: number; slow: number } => ({ all, media: all, slow });

test('a 10-minute window sends a sixth of the base floor, and never less than the effective minimum', () => {
  assert.equal(effectiveFloor('all', at(1_200), P), 200);
  assert.equal(effectiveFloor('all', at(100), P), P.feed.effectiveFloorMin);
  assert.equal(effectiveFloor('all', at(10), P), P.feed.effectiveFloorMin, 'a base below the minimum is lifted to it first');
  assert.equal(effectiveFloor('all', at(10_000_000), P), Math.round(P.feed.floorMax / 6));
});

test('★ the slow lane sends its own floor in full, and never less than 5x what the main lane sends', () => {
  assert.equal(effectiveFloor('slow', at(1_200, 5_000), P), 5_000, 'six hours is past the full window: no scaling');
  assert.equal(effectiveFloor('slow', at(1_200, 100), P), 200 * P.feed.slow.floorMultiple, 'adapted low, held at 5x main');
  assert.equal(effectiveFloor('slow', at(10_000_000, 10_000_000), P), P.feed.floorMax);
  assert.deepEqual(sentFloors(at(1_200, 5_000), P), { all: 200, media: 200, slow: 5_000 });
});

test('★ the targets spend the catch-all share of the day: a fifth on the slow lane, a quarter of the rest to media', () => {
  // $1 a day, $0.00015 a post, a pass every two minutes, the slow lane every fifteen.
  const t = laneTargets(1, 0.00015, 720, P);
  const posts = (1 * P.feed.budgetShare) / 0.00015;
  const main = (posts * (1 - P.feed.slow.share)) / 720;
  assert.ok(Math.abs(t.all + t.media - main) < 1e-9);
  assert.ok(Math.abs(t.media / main - P.feed.mediaShare) < 1e-9);
  assert.ok(Math.abs(t.slow * 96 - posts * P.feed.slow.share) < 1e-9);
  assert.ok(Math.abs(((t.all + t.media) * 720 + t.slow * 96) * 0.00015 - P.feed.budgetShare) < 1e-9, 'a day at target is the share, exactly');
});

test('the slow lane is due on the first pass, then every fifteen minutes', () => {
  assert.equal(slowLaneDue(0, null, P), true);
  assert.equal(slowLaneDue(P.feed.slow.everyMs - 1, 0, P), false);
  assert.equal(slowLaneDue(P.feed.slow.everyMs, 0, P), true);
});

test('a free source or no passes has no target rather than an infinite one', () => {
  assert.deepEqual(laneTargets(1, 0, 720, P), { all: 0, media: 0, slow: 0 });
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

test('every lane starts where policy says; the slow lane at 5x the main start', () => {
  assert.deepEqual(startFloors(P), { all: P.feed.startFloor, media: P.feed.mediaStartFloor, slow: P.feed.startFloor * P.feed.slow.floorMultiple });
});

/* ── fresh bands (feed.fresh) ── */

const FRESH = { ...P, feed: { ...P.feed, fresh: { ...P.feed.fresh, enabled: true } } };
const MIN = 60_000;

test('fresh is off by default, and off it changes no target and covers no slow slice', () => {
  assert.equal(P.feed.fresh.enabled, false);
  assert.equal(P.feed.fresh.cutStale, false);
  const t = laneTargets(1, 0.00015, 720, P);
  assert.ok(t.media > 0);
  assert.equal(sliceCoveredByBands(45, P), false);
});

test('a band floor scales the base to the band age, in full from the full window on', () => {
  assert.equal(bandFloor(30, at(600), P), 300);
  assert.equal(bandFloor(6, at(600), P), 60);
  assert.equal(bandFloor(120, at(600), P), 600);
  assert.equal(bandFloor(1, at(600), P), P.feed.effectiveFloorMin);
});

test('band windows tile posting time: each starts where the last ended, never further back than the cap', () => {
  const now = 1_000 * MIN;
  const first = bandWindow(25, null, now, P);
  assert.deepEqual(first, { since: now - (25 + P.feed.fresh.maxWindowMin) * MIN, until: now - 25 * MIN });
  const next = bandWindow(25, first!.until, now + 2 * MIN, P);
  assert.deepEqual(next, { since: first!.until, until: now - 23 * MIN }, 'no gap, no overlap');
  assert.equal(bandWindow(25, now - 25 * MIN, now, P), null, 'nothing new to ask');
  const late = bandWindow(25, now - 200 * MIN, now, P);
  assert.equal(late!.since, now - (25 + P.feed.fresh.maxWindowMin) * MIN, 'a long outage reaches back the cap only');
});

test('fresh on: the media lane gets no target, the all lane both lanes\' money times the scale, the slow lane its own', () => {
  const off = laneTargets(1, 0.00015, 720, P);
  const on = laneTargets(1, 0.00015, 720, FRESH);
  assert.equal(on.media, 0);
  assert.ok(Math.abs(on.all - (off.all + off.media) * P.feed.fresh.targetScale) < 1e-9);
  assert.equal(on.slow, off.slow);
});

test('fresh on: a slow slice whose youngest age is inside the oldest band is covered', () => {
  const oldest = Math.max(...P.feed.fresh.bandAgesMin);
  assert.equal(sliceCoveredByBands(oldest - 5, FRESH), true);
  assert.equal(sliceCoveredByBands(oldest + 55, FRESH), false);
});
