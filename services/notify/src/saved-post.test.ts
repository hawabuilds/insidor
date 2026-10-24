/** A saved post's two pushes: the first tied coin launched after the save that starts running; the pick once, only if it is another; never a third. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { LAUNCHPAD_VENUE } from './coin-gate.ts';
import { firstSavedKey, isRunning, runningSavedKey, savedMemory, savedPostStep, type LastHour, type SavedCoin, type SavedRule } from './saved-post.ts';

const POSTED = Date.parse('2026-10-23T06:33:42Z');
const SAVED = Date.parse('2026-10-23T17:11:42Z');
const HOUR = 3_600_000;
const RULE: SavedRule = { maxLaunchAgeMs: 3 * HOUR, running: { minVolume1hUsd: 1_000, minTrades1h: 20 } };
const ITEM = 'x:2113519213507969247';
const BUSY: LastHour = { volume1hUsd: 400_000, trades1h: 8_500 };
const coin = (address: string, launched: string, hour: LastHour | null = BUSY, over: Partial<SavedCoin['gate']> = {}): SavedCoin => ({
  address,
  gate: { venueId: LAUNCHPAD_VENUE, origin: 'live_stream', launchedMs: Date.parse(launched), hadPostMs: POSTED, ...over },
  hour,
});
const NONE = { first: null, running: false };

test('★ running is the strip\'s test: enough dollars AND enough trades; no hour is not running', () => {
  assert.equal(isRunning({ volume1hUsd: 1_000, trades1h: 20 }, RULE.running), true);
  assert.equal(isRunning({ volume1hUsd: 999, trades1h: 500 }, RULE.running), false);
  assert.equal(isRunning({ volume1hUsd: 50_000, trades1h: 19 }, RULE.running), false, 'a few large fills are not running');
  assert.equal(isRunning(null, RULE.running), false);
  assert.deepEqual([DEFAULT_POLICY.runningCoins.minVolume1hUsd, DEFAULT_POLICY.runningCoins.minTrades1h], [1_000, 20], 'the bars in force');
});

test('★ the first tied coin after the save that STARTS RUNNING is pushed, without waiting for the pick; a dud tied earlier is not', () => {
  const dud = coin('DUD', '2026-10-23T19:33:13Z', { volume1hUsd: 64, trades1h: 7 });
  const unread = coin('UNREAD', '2026-10-23T22:47:11Z', null);
  const kuribo = coin('KURIBO', '2026-10-23T22:47:15Z');
  const s = savedPostStep(ITEM, SAVED, [dud, unread, kuribo], null, NONE, Date.parse('2026-10-23T22:51:55Z'), RULE, false);
  assert.deepEqual(s.push, { kind: 'first', address: 'KURIBO' });
  assert.deepEqual(s.remember, [firstSavedKey(ITEM, 'KURIBO')]);
  assert.deepEqual(savedPostStep(ITEM, SAVED, [dud, unread], null, NONE, Date.parse('2026-10-23T22:51:55Z'), RULE, false), { push: null, remember: [] }, 'nothing running: wait, remember nothing');
});

test('two running at once: the busier hour', () => {
  const s = savedPostStep(ITEM, SAVED, [coin('A', '2026-10-23T22:47:00Z', { volume1hUsd: 2_000, trades1h: 40 }), coin('B', '2026-10-23T22:48:00Z')], null, NONE, Date.parse('2026-10-23T22:52:00Z'), RULE, false);
  assert.deepEqual(s.push, { kind: 'first', address: 'B' });
});

test('★ a coin that launched before the save, or before the post, or off the launchpad, or hours ago, is never the first, running or not', () => {
  const now = Date.parse('2026-10-23T22:48:00Z');
  const before = coin('BEFORE', '2026-10-23T10:14:10Z');
  const older = coin('OLDER', '2026-10-23T22:47:00Z', BUSY, { hadPostMs: Date.parse('2026-10-23T23:00:00Z') });
  const elsewhere = coin('ELSEWHERE', '2026-10-23T22:47:00Z', BUSY, { venueId: 'solana:meteora' });
  const unknown = coin('UNKNOWN', '2026-10-23T22:47:00Z', BUSY, { launchedMs: null });
  const stale = coin('STALE', '2026-10-23T18:00:00Z');
  assert.deepEqual(savedPostStep(ITEM, SAVED, [before, older, elsewhere, unknown, stale], null, NONE, now, RULE, false), { push: null, remember: [] });
});

test('★ the pick, when it is another coin, is pushed once as the one running; the same coin is not pushed again', () => {
  const now = Date.parse('2026-10-23T23:54:00Z');
  const first = { first: 'COPY', running: false };
  assert.deepEqual(savedPostStep(ITEM, SAVED, [], coin('KURIBO', '2026-10-23T22:47:15Z'), first, now, RULE, false), { push: { kind: 'running', address: 'KURIBO' }, remember: [runningSavedKey(ITEM)] });
  assert.deepEqual(savedPostStep(ITEM, SAVED, [], coin('COPY', '2026-10-23T23:38:33Z'), first, now, RULE, false), { push: null, remember: [] }, 'the pick is the coin already pushed');
  assert.deepEqual(savedPostStep(ITEM, SAVED, [], coin('THIRD', '2026-10-23T23:50:00Z'), { first: 'COPY', running: true }, now, RULE, false), { push: null, remember: [] }, 'never a third push');
  assert.deepEqual(savedPostStep(ITEM, SAVED, [], coin('OFF', '2026-10-23T22:47:15Z', BUSY, { venueId: null }), first, now, RULE, false).push, null, 'the gate holds for the second push too');
});

test('★ a pick that came before any first push settles the post: pushed if it launched after the save, else remembered silently', () => {
  const now = Date.parse('2026-10-23T23:54:00Z');
  const ties = [coin('LATER', '2026-10-23T23:50:00Z')];
  assert.deepEqual(savedPostStep(ITEM, SAVED, ties, coin('KURIBO', '2026-10-23T22:47:15Z'), NONE, now, RULE, false).push, { kind: 'first', address: 'KURIBO' });
  const settled = savedPostStep(ITEM, SAVED, ties, coin('EARLY', '2026-10-23T10:14:10Z'), NONE, now, RULE, false);
  assert.equal(settled.push, null, 'the running coin was there before the save: a later coin is not announced over it');
  assert.deepEqual(settled.remember, [firstSavedKey(ITEM, 'EARLY')]);
});

test('★ the first look remembers what every saved post already has and sends nothing', () => {
  const now = Date.parse('2026-10-23T23:54:00Z');
  assert.deepEqual(savedPostStep(ITEM, SAVED, [coin('A', '2026-10-23T22:47:15Z')], null, NONE, now, RULE, true), { push: null, remember: [firstSavedKey(ITEM, 'A')] });
  assert.deepEqual(savedPostStep(ITEM, SAVED, [coin('Q', '2026-10-23T22:47:15Z', null)], null, NONE, now, RULE, true), { push: null, remember: [] }, 'a coin not running yet is not remembered: it may still be the first');
  assert.deepEqual(savedPostStep(ITEM, SAVED, [], coin('K', '2026-10-23T22:47:15Z'), NONE, now, RULE, true), { push: null, remember: [firstSavedKey(ITEM, 'K'), runningSavedKey(ITEM)] });
  assert.deepEqual(savedPostStep(ITEM, SAVED, [], coin('K', '2026-10-23T22:47:15Z'), { first: 'A', running: false }, now, RULE, true), { push: null, remember: [runningSavedKey(ITEM)] });
});

test('the memory is read back from the seen keys', () => {
  assert.deepEqual(savedMemory(ITEM, new Set()), NONE);
  assert.deepEqual(savedMemory(ITEM, new Set([firstSavedKey(ITEM, 'A'), runningSavedKey(ITEM), firstSavedKey('x:1', 'B')])), { first: 'A', running: true });
});
