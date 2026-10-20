/**
 * The coin-first route: the next step for a post a running coin links, and when For You takes it —
 * the age bound both ways, the pick that must be a tying coin, and a post joining once.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { coinFirstAdmits, coinFirstBars, coinFirstStep, firstTie, inRouteAge, type CoinFirstAdmitFacts, type CoinFirstTarget } from './coin-first.ts';

const H = 3_600_000;
const BARS = { maxPostAgeAtLaunchMs: 48 * H, launchAllowanceMs: 600_000, admitWithinMs: 2 * H };
const POST = 1_000 * H;

test('the bars come from the one-coin link bound, the origin allowance and the route', () => {
  const b = coinFirstBars(DEFAULT_POLICY);
  assert.equal(b.maxPostAgeAtLaunchMs, DEFAULT_POLICY.oneCoin.linkMaxAgeMs);
  assert.equal(b.launchAllowanceMs, DEFAULT_POLICY.origin.launchAllowanceMs);
  assert.equal(b.admitWithinMs, DEFAULT_POLICY.rising.coinFirst.admitWithinMs);
});

test('the age bound: up to 48 hours after the post, a few minutes of skew before it, and an unknown is no', () => {
  assert.equal(inRouteAge(POST, POST + 48 * H, BARS), true);
  assert.equal(inRouteAge(POST, POST + 48 * H + 1, BARS), false);
  assert.equal(inRouteAge(POST, POST - 600_000, BARS), true);
  assert.equal(inRouteAge(POST, POST - 600_001, BARS), false);
  assert.equal(inRouteAge(null, POST, BARS), false);
  assert.equal(inRouteAge(POST, null, BARS), false);
});

const target = (over: Partial<CoinFirstTarget>): CoinFirstTarget => ({
  held: true, postedAtMs: POST, launchedAtMs: POST + H, judged: false, credited: false, fetchAsked: false, judgeAsked: false, ...over,
});

test('the next step: read a post we do not hold once, ask the judge once, then credit it', () => {
  assert.equal(coinFirstStep(target({ held: false, postedAtMs: null }), BARS), 'fetch');
  assert.equal(coinFirstStep(target({ held: false, postedAtMs: null, fetchAsked: true }), BARS), 'gone');
  assert.equal(coinFirstStep(target({}), BARS), 'judge');
  assert.equal(coinFirstStep(target({ judgeAsked: true }), BARS), 'wait');
  assert.equal(coinFirstStep(target({ judged: true }), BARS), 'credit');
  assert.equal(coinFirstStep(target({ judged: true, credited: true }), BARS), 'done');
});

test('a post too old at the launch, or with no time, costs nothing', () => {
  assert.equal(coinFirstStep(target({ launchedAtMs: POST + 49 * H }), BARS), 'out_of_age');
  assert.equal(coinFirstStep(target({ postedAtMs: null }), BARS), 'out_of_age');
});

const facts = (over: Partial<CoinFirstAdmitFacts>): CoinFirstAdmitFacts => ({
  postedAtMs: POST,
  pick: { outcome: 'picked', address: 'COIN' },
  ties: [{ address: 'COIN', launchedAtMs: POST + H }],
  admittedAtMs: null,
  member: false,
  ...over,
});
const NOW = POST + H + 10 * 60_000;

test('the picked coin ties the post: it joins', () => {
  assert.equal(coinFirstAdmits(facts({}), NOW, BARS), true);
});

test('no pick, a waiting pick, or a pick of a coin that does not tie it: it does not join', () => {
  assert.equal(coinFirstAdmits(facts({ pick: null }), NOW, BARS), false);
  assert.equal(coinFirstAdmits(facts({ pick: { outcome: 'waiting', address: null } }), NOW, BARS), false);
  assert.equal(coinFirstAdmits(facts({ pick: { outcome: 'picked', address: 'NAME_ONLY' } }), NOW, BARS), false);
});

test('a tying coin launched past the age bound does not bring the post in', () => {
  assert.equal(coinFirstAdmits(facts({ ties: [{ address: 'COIN', launchedAtMs: POST + 49 * H }] }), POST + 49 * H + 60_000, BARS), false);
});

test('a post joins once: let in before and gone since, it stays out; a member stays', () => {
  assert.equal(coinFirstAdmits(facts({ admittedAtMs: NOW - 60_000 }), NOW, BARS), false);
  assert.equal(coinFirstAdmits(facts({ admittedAtMs: NOW - 60_000, member: true }), NOW, BARS), true);
});

test('the route closes `admitWithinMs` after the launch', () => {
  assert.equal(coinFirstAdmits(facts({}), POST + H + 2 * H, BARS), true);
  assert.equal(coinFirstAdmits(facts({}), POST + H + 2 * H + 1, BARS), false);
});

test('the first coin is the earliest launch, the lower address on a tie, and an unknown launch is never first', () => {
  assert.deepEqual(firstTie([{ address: 'B', launchedAtMs: 5 }, { address: 'A', launchedAtMs: 5 }, { address: 'C', launchedAtMs: null }]), { address: 'A', launchedAtMs: 5 });
  assert.equal(firstTie([{ address: 'C', launchedAtMs: null }]), null);
});
