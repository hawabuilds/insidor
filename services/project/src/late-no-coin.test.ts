/**
 * THE LATE ROUTE (late-no-coin.ts) on its own: when a post found late is the route's, the yes it is
 * held to, and which of its posts join For You's list under the frame's cut. The moustache-baby post
 * of 22-23 Oct is the worked case.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import { postScoreReason } from '@insidor/core';

import { beyondCap, lateAnswerPolicy, lateHolds, lateLets, loadLateNoCoin, type LateRecord } from './late-no-coin.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;

/* @MalconSxRD's moustache baby: posted 22 Oct 16:39 UTC, found 23 Oct 07:16, its first running coin seen 23:28. */
const POSTED = Date.UTC(2026, 9, 22, 16, 39, 25);
const MOUSTACHE: LateRecord = {
  itemId: 'x:2113309260956287057',
  postedAtMs: POSTED,
  foundAtMs: Date.UTC(2026, 9, 23, 7, 16, 27),
  coinAtMs: Date.UTC(2026, 9, 23, 23, 28, 38),
  coinAddress: 'J9WL4zQVCFvLTydjtHoMGcLasjhRMZomnVmp4Y2cpump',
};

test('★ the moustache post is the route\'s from when it was found until its coin ran', () => {
  assert.equal(lateHolds(MOUSTACHE, MOUSTACHE.foundAtMs + 5 * MIN), true);
  assert.equal(lateHolds(MOUSTACHE, MOUSTACHE.coinAtMs! - MIN), true);
  assert.equal(lateHolds(MOUSTACHE, MOUSTACHE.coinAtMs!), false);
});

test('a post found inside the six hours is not the route\'s: For You\'s own gates had their chance', () => {
  const young = { ...MOUSTACHE, foundAtMs: POSTED + DEFAULT_POLICY.rising.fypMaxAgeMs };
  assert.equal(lateHolds(young, young.foundAtMs + MIN), false);
});

test('★ with no coin at all, the route lets go at its age cap', () => {
  const none = { ...MOUSTACHE, coinAtMs: null, coinAddress: null };
  const cap = DEFAULT_POLICY.lateNoCoin.maxPostAgeMs;
  assert.equal(lateHolds(none, POSTED + cap), true);
  assert.equal(lateHolds(none, POSTED + cap + 1), false);
});

test('★ the judge\'s yes, the views bar, and no coin on the card or in the owner\'s word', () => {
  const late = new Map([[MOUSTACHE.itemId, MOUSTACHE]]);
  const post = { itemId: MOUSTACHE.itemId, judgedYes: true, byViews: true, picked: false, ownerCoin: false };
  assert.equal(lateLets(post, late), true);
  assert.equal(lateLets({ ...post, judgedYes: false }, late), false);
  assert.equal(lateLets({ ...post, byViews: false }, late), false);
  assert.equal(lateLets({ ...post, picked: true }, late), false);
  assert.equal(lateLets({ ...post, ownerCoin: true }, late), false);
  assert.equal(lateLets(post, new Map()), false);
});

test('★ near the bar: the moustache post\'s 0.72 on a video frame is a yes on this route, not on For You\'s own', () => {
  const answer = { coinable: true, confidence: 0.72, lookedAt: 'videoFrame' as const, proposedName: 'MORGAN' };
  assert.equal(postScoreReason(answer, DEFAULT_POLICY), 'judge_unsure');
  assert.equal(postScoreReason(answer, lateAnswerPolicy(DEFAULT_POLICY)), 'passes');
  const strict: Policy = { ...DEFAULT_POLICY, lateNoCoin: { ...DEFAULT_POLICY.lateNoCoin, nearBar: false } };
  assert.equal(postScoreReason(answer, lateAnswerPolicy(DEFAULT_POLICY, strict)), 'judge_unsure');
  /* Further under than the margin is still unsure, and a no stays a no. */
  assert.equal(postScoreReason({ ...answer, confidence: 0.6 }, lateAnswerPolicy(DEFAULT_POLICY)), 'judge_unsure');
  assert.equal(postScoreReason({ ...answer, coinable: false }, lateAnswerPolicy(DEFAULT_POLICY)), 'not_memeable');
});

test('★ under the cut, only the late route\'s posts that are not members yet join the list', () => {
  const list = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  assert.deepEqual(beyondCap(list, 2, new Set(['b', 'd', 'e']), new Set(['e'])).map((p) => p.id), ['d']);
  assert.deepEqual(beyondCap(list, 10, new Set(['d']), new Set()), []);
});

test('switched off, the route reads nothing and holds nothing', async () => {
  const off: Policy = { ...DEFAULT_POLICY, lateNoCoin: { ...DEFAULT_POLICY.lateNoCoin, on: false } };
  const db = { query: async () => { throw new Error('read while off'); } };
  assert.equal((await loadLateNoCoin(db as never, POSTED, off)).size, 0);
});

test('★ the read holds the coin to the running bar and the six hours to For You\'s own', async () => {
  const asked: unknown[][] = [];
  const db = { query: async (_sql: string, params: unknown[]) => (asked.push(params), [
    { item_id: MOUSTACHE.itemId, posted_at: new Date(POSTED), first_seen_at: new Date(MOUSTACHE.foundAtMs), coin_at: new Date(MOUSTACHE.coinAtMs!), coin_address: MOUSTACHE.coinAddress },
  ]) };
  const now = MOUSTACHE.foundAtMs + HOUR;
  const got = await loadLateNoCoin(db as never, now);
  assert.deepEqual(got.get(MOUSTACHE.itemId), MOUSTACHE);
  const [since, sixHours, only, cap] = asked[0] ?? [];
  assert.equal(since, new Date(now - DEFAULT_POLICY.lateNoCoin.maxPostAgeMs).toISOString());
  assert.equal(sixHours, DEFAULT_POLICY.rising.fypMaxAgeMs);
  assert.equal(only, null);
  assert.equal(cap, DEFAULT_POLICY.oneCoin.minCapUsd);
  /* After the coin ran, the same row is no longer the route's. */
  assert.equal((await loadLateNoCoin(db as never, MOUSTACHE.coinAtMs! + MIN)).size, 0);
});
