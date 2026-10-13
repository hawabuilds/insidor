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

test('★ For You takes a post taking off: 10k inside 15 minutes, or 1,000 a minute in the first hour', () => {
  assert.equal(clearsReachBar('fyp', [at(12, 10_500)], POSTED, P), true);
  assert.equal(clearsReachBar('fyp', [at(30, 31_000)], POSTED, P), true);
  assert.equal(clearsReachBar('fyp', [at(30, 20_000)], POSTED, P), false, '667 a minute is not fast');
  assert.equal(clearsReachBar('fyp', [at(90, 30_000)], POSTED, P), false, 'outside the first hour only 40k counts');
});

test('a post cleared early stays cleared after it slows', () => {
  assert.equal(clearsReachBar('fyp', [at(10, 11_000), at(300, 25_000)], POSTED, P), true);
});

test('Popular needs 250k', () => {
  assert.equal(clearsReachBar('popular', [at(60, 249_999)], POSTED, P), false);
  assert.equal(clearsReachBar('popular', [at(60, 250_000)], POSTED, P), true);
});

test('★ unread views, or no post time for the growth paths, never pass', () => {
  assert.equal(clearsReachBar('fyp', [], POSTED, P), false);
  assert.equal(clearsReachBar('fyp', [at(5, null)], POSTED, P), false);
  assert.equal(clearsReachBar('fyp', [at(5, 12_000)], null, P), false);
});
