/** The owner's view bars: 40k or fast early growth for For You, 250k for Popular, unread never passes. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY as P } from '@insidor/contracts/policy.ts';

import { clearsReachBar } from './reach-bar.ts';

const POSTED = 1_800_000_000_000;
const MIN = 60_000;
const at = (minutes: number, reach: number | null) => ({ atMs: POSTED + minutes * MIN, reach });

test('For You: 40k views passes at any age; 39k a day later does not', () => {
  assert.equal(clearsReachBar('fyp', [at(600, 40_000)], POSTED, P), true);
  assert.equal(clearsReachBar('fyp', [at(1_440, 39_000)], POSTED, P), false);
});

test('★ For You takes a post taking off: 20k inside 15 minutes, or 2,000 a minute in the first half hour', () => {
  assert.equal(clearsReachBar('fyp', [at(12, 20_500)], POSTED, P), true);
  assert.equal(clearsReachBar('fyp', [at(12, 15_000)], POSTED, P), false, '15k at 12 minutes stalls too often');
  assert.equal(clearsReachBar('fyp', [at(18, 39_000)], POSTED, P), true, '39k in 18 minutes is 2,167 a minute');
  assert.equal(clearsReachBar('fyp', [at(30, 31_000)], POSTED, P), false, '1,033 a minute is not fast');
  assert.equal(clearsReachBar('fyp', [at(45, 39_000)], POSTED, P), false, 'outside the first half hour only 40k counts');
});

test('a post cleared early stays cleared after it slows', () => {
  assert.equal(clearsReachBar('fyp', [at(10, 21_000), at(300, 25_000)], POSTED, P), true);
});

test('Popular needs 250k', () => {
  assert.equal(clearsReachBar('popular', [at(60, 249_999)], POSTED, P), false);
  assert.equal(clearsReachBar('popular', [at(60, 250_000)], POSTED, P), true);
});

test('★ unread views, or no post time for the growth paths, never pass', () => {
  assert.equal(clearsReachBar('fyp', [], POSTED, P), false);
  assert.equal(clearsReachBar('fyp', [at(5, null)], POSTED, P), false);
  assert.equal(clearsReachBar('fyp', [at(5, 22_000)], null, P), false);
});

test('★ a short video takes its own growth paths: 150k inside two hours, or 1,500 a minute inside four', () => {
  const S = P.rising.shortVideoReachScale;
  /* Measured 2026-10-13: the fastest newly found video, 130k at 72 minutes (1,812 a minute). */
  assert.equal(clearsReachBar('fyp', [at(72, 130_460)], POSTED, P, S), true, '1,812 a minute inside four hours');
  assert.equal(clearsReachBar('fyp', [at(76, 53_312)], POSTED, P, S), false, '700 a minute waits for the 500k bar');
  assert.equal(clearsReachBar('fyp', [at(110, 150_000)], POSTED, P, S), true, '150k inside two hours');
  assert.equal(clearsReachBar('fyp', [at(214, 391_100)], POSTED, P, S), true, '1,827 a minute at 3.6 hours');
  assert.equal(clearsReachBar('fyp', [at(200, 251_700)], POSTED, P, S), false, '1,258 a minute at 3.3 hours is not fast');
  assert.equal(clearsReachBar('fyp', [at(300, 480_000)], POSTED, P, S), false, 'past four hours only the 500k total counts');
  assert.equal(clearsReachBar('fyp', [at(300, 500_000)], POSTED, P, S), true);
  /* The text paths are untouched by the short-video ones. */
  assert.equal(clearsReachBar('fyp', [at(72, 130_460)], POSTED, P), true, 'a text post at 130k is over 40k anyway');
  assert.equal(clearsReachBar('fyp', [at(90, 39_000)], POSTED, P), false);
});

const SPEED = { ...P, rising: { ...P.rising, speedBar: { ...P.rising.speedBar, enabled: true } } };

test('the speed bar is off by default: a post on pace for 40k waits for a bar it clears today', () => {
  assert.equal(P.rising.speedBar.enabled, false);
  assert.equal(clearsReachBar('fyp', [at(40, 25_000)], POSTED, P), false);
});

test('speed bar: on pace for 40k by 90 minutes (444 a minute) from half an hour old passes', () => {
  assert.equal(clearsReachBar('fyp', [at(40, 25_000)], POSTED, SPEED), true, '625 a minute at 40 minutes');
  assert.equal(clearsReachBar('fyp', [at(60, 27_000)], POSTED, SPEED), true, '450 a minute at an hour');
  assert.equal(clearsReachBar('fyp', [at(60, 26_000)], POSTED, SPEED), false, '433 a minute is not on pace');
  assert.equal(clearsReachBar('fyp', [at(25, 14_000)], POSTED, SPEED), false, 'under 15k views is too few to read a pace from');
  assert.equal(clearsReachBar('fyp', [at(20, 18_000)], POSTED, SPEED), false, 'under half an hour old the early paths decide');
  assert.equal(clearsReachBar('fyp', [at(100, 39_000)], POSTED, SPEED), false, 'past 90 minutes only the 40k total counts');
});

test('speed bar: a post that spiked and stalled is not on pace, one still climbing is', () => {
  assert.equal(clearsReachBar('fyp', [at(25, 22_000), at(45, 23_000)], POSTED, SPEED), false, '50 a minute since the last reading');
  assert.equal(clearsReachBar('fyp', [at(25, 14_000), at(45, 24_000)], POSTED, SPEED), true, '500 a minute since the last reading');
  assert.equal(clearsReachBar('fyp', [at(45, 24_000), at(25, 14_000)], POSTED, SPEED), true, 'readings out of order are read by time');
  assert.equal(clearsReachBar('fyp', [at(40, 24_000), at(42, 24_100)], POSTED, SPEED), true, 'two minutes apart is too close to judge a recent pace: the first reading stands');
});

test('speed bar: never the short-video source, never an unread or undated post', () => {
  assert.equal(clearsReachBar('fyp', [at(40, 50_000)], POSTED, SPEED, P.rising.shortVideoReachScale), false, '1,250 a minute is under its own fast path');
  assert.equal(clearsReachBar('fyp', [at(40, null)], POSTED, SPEED), false);
  assert.equal(clearsReachBar('fyp', [at(40, 25_000)], null, SPEED), false);
});

test('speed bar on: everything that passes with it off still passes', () => {
  for (const readings of [[at(600, 40_000)], [at(12, 20_500)], [at(18, 39_000)], [at(10, 21_000), at(300, 25_000)]]) {
    assert.equal(clearsReachBar('fyp', readings, POSTED, SPEED), true);
  }
});
