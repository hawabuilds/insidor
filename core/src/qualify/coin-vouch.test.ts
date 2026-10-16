/** A coin naming a young, approved post stands in for its views; anything unknown or off does not. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { coinVouches } from './coin-vouch.ts';

const P = { ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, coinLinked: { on: true, maxPostAgeAtLaunchMs: 6 * 3_600_000, minApprovals: 5_000 } } };
const POSTED = 1_800_000_000_000;
const MIN = 60_000;

test('a coin launched minutes after a post with 5,000 approvals vouches for it', () => {
  assert.equal(coinVouches({ postedAtMs: POSTED, firstCoinAtMs: POSTED + 3 * MIN, approvals: 5_000 }, P), true);
  assert.equal(coinVouches({ postedAtMs: POSTED, firstCoinAtMs: POSTED + 360 * MIN, approvals: 9_000 }, P), true, 'six hours is inside');
});

test('a coin launched over six hours after the post, or a post under 5,000 approvals, does not', () => {
  assert.equal(coinVouches({ postedAtMs: POSTED, firstCoinAtMs: POSTED + 361 * MIN, approvals: 50_000 }, P), false);
  assert.equal(coinVouches({ postedAtMs: POSTED, firstCoinAtMs: POSTED + MIN, approvals: 4_999 }, P), false);
});

test('a coin launched before the post only within the launch allowance', () => {
  assert.equal(coinVouches({ postedAtMs: POSTED, firstCoinAtMs: POSTED - 5 * MIN, approvals: 6_000 }, P), true);
  assert.equal(coinVouches({ postedAtMs: POSTED, firstCoinAtMs: POSTED - 11 * MIN, approvals: 6_000 }, P), false);
});

test('★ an unknown is not a pass: no post time, no coin, no approvals reading', () => {
  assert.equal(coinVouches({ postedAtMs: null, firstCoinAtMs: POSTED, approvals: 6_000 }, P), false);
  assert.equal(coinVouches({ postedAtMs: POSTED, firstCoinAtMs: null, approvals: 6_000 }, P), false);
  assert.equal(coinVouches({ postedAtMs: POSTED, firstCoinAtMs: POSTED + MIN, approvals: null }, P), false);
});

test('switched off, no coin vouches for anything', () => {
  const off = { ...P, rising: { ...P.rising, coinLinked: { ...P.rising.coinLinked, on: false } } };
  assert.equal(coinVouches({ postedAtMs: POSTED, firstCoinAtMs: POSTED + MIN, approvals: 50_000 }, off), false);
});
