/**
 * The coin-first route on For You: a post the route recorded joins on the judge's yes and a pick that
 * ties it, and the owner's word, the safety net and a coin he called wrong all keep it out; the route
 * is in force only while the pick is what the cards show.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { coinFirstLets, coinFirstOn, type CoinFirstFrame, type CoinFirstPost } from './coin-first.ts';

const H = 3_600_000;
const POSTED = 1_000 * H;
const LAUNCH = POSTED + 30 * H;
const NOW = LAUNCH + 12 * 60_000;

const frame = (admittedAtMs: number | null = null): CoinFirstFrame => ({
  records: new Map([['p', { itemId: 'p', coinAddress: 'COIN', launchedAtMs: LAUNCH as Millis, firstCoinAddress: 'COIN', admittedAtMs: admittedAtMs as Millis | null }]]),
  ties: new Map([['p', [{ address: 'COIN', launchedAtMs: LAUNCH as Millis }]]]),
});

const post = (over: Partial<CoinFirstPost>): CoinFirstPost => ({
  itemId: 'p', postedAtMs: POSTED, judgedYes: true, pick: { outcome: 'picked', address: 'COIN' }, member: false, ownerNone: false, wrong: new Set(), ...over,
});

test('the judge said yes and the pick is the coin that linked it: it joins, a day and more after it went up', () => {
  assert.equal(coinFirstLets(post({}), frame(), NOW, DEFAULT_POLICY), true);
});

test('no yes, the safety net, or no record: it does not', () => {
  assert.equal(coinFirstLets(post({ judgedYes: false }), frame(), NOW, DEFAULT_POLICY), false);
  assert.equal(coinFirstLets(post({ itemId: 'other' }), frame(), NOW, DEFAULT_POLICY), false);
});

test("the owner's word keeps it out: no coin is from this, or the pick is a coin he called wrong", () => {
  assert.equal(coinFirstLets(post({ ownerNone: true }), frame(), NOW, DEFAULT_POLICY), false);
  assert.equal(coinFirstLets(post({ wrong: new Set(['COIN']) }), frame(), NOW, DEFAULT_POLICY), false);
});

test('let in once: recorded and no longer on For You, it stays off; a member stays', () => {
  assert.equal(coinFirstLets(post({}), frame(NOW - 60_000), NOW, DEFAULT_POLICY), false);
  assert.equal(coinFirstLets(post({ member: true }), frame(NOW - 60_000), NOW, DEFAULT_POLICY), true);
});

test('in force only while on and the pick is live', () => {
  assert.equal(coinFirstOn(DEFAULT_POLICY), DEFAULT_POLICY.rising.coinFirst.on && DEFAULT_POLICY.oneCoin.mode === 'live');
  assert.equal(coinFirstOn({ ...DEFAULT_POLICY, oneCoin: { ...DEFAULT_POLICY.oneCoin, mode: 'shadow' } }), false);
  assert.equal(coinFirstOn({ ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, coinFirst: { ...DEFAULT_POLICY.rising.coinFirst, on: false } } }), false);
});
