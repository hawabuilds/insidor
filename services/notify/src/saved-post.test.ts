/** A saved post's two pushes: the first coin launched after the save, at once; the running coin once, only if it is another; never a third. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { LAUNCHPAD_VENUE } from './coin-gate.ts';
import { firstSavedKey, runningSavedKey, savedMemory, savedPostStep, type SavedCoin } from './saved-post.ts';

const POSTED = Date.parse('2026-10-23T06:33:42Z');
const SAVED = Date.parse('2026-10-23T17:11:42Z');
const HOUR = 3_600_000;
const MAX_AGE = 3 * HOUR;
const ITEM = 'x:2113519213507969247';
const coin = (address: string, launched: string, over: Partial<SavedCoin['gate']> = {}): SavedCoin => ({ address, gate: { venueId: LAUNCHPAD_VENUE, origin: 'live_stream', launchedMs: Date.parse(launched), hadPostMs: POSTED, ...over } });
const NONE = { first: null, running: false };

test('★ the first coin launched after the save is pushed as soon as it is tied, without waiting for the pick', () => {
  const kuribo = coin('KURIBO', '2026-10-23T22:47:15Z');
  const s = savedPostStep(ITEM, SAVED, [kuribo, coin('LATER', '2026-10-23T22:51:00Z')], null, NONE, Date.parse('2026-10-23T22:47:30Z'), MAX_AGE, false);
  assert.deepEqual(s.push, { kind: 'first', address: 'KURIBO' });
  assert.deepEqual(s.remember, [firstSavedKey(ITEM, 'KURIBO')]);
});

test('★ a coin that launched before the save, or before the post, or off the launchpad, is never the first', () => {
  const now = Date.parse('2026-10-23T22:48:00Z');
  const before = coin('BEFORE', '2026-10-23T10:14:10Z');
  const older = coin('OLDER', '2026-10-23T22:47:00Z', { hadPostMs: Date.parse('2026-10-23T23:00:00Z') });
  const elsewhere = coin('ELSEWHERE', '2026-10-23T22:47:00Z', { venueId: 'solana:meteora' });
  const unknown = coin('UNKNOWN', '2026-10-23T22:47:00Z', { launchedMs: null });
  assert.deepEqual(savedPostStep(ITEM, SAVED, [before, older, elsewhere, unknown], null, NONE, now, MAX_AGE, false), { push: null, remember: [] });
});

test('★ the pick, when it is another coin, is pushed once as the one running; the same coin is not pushed again', () => {
  const now = Date.parse('2026-10-23T23:54:00Z');
  const first = { first: 'DUD', running: false };
  assert.deepEqual(savedPostStep(ITEM, SAVED, [], coin('KURIBO', '2026-10-23T22:47:15Z'), first, now, MAX_AGE, false), { push: { kind: 'running', address: 'KURIBO' }, remember: [runningSavedKey(ITEM)] });
  assert.deepEqual(savedPostStep(ITEM, SAVED, [], coin('DUD', '2026-10-23T19:33:13Z'), first, now, MAX_AGE, false), { push: null, remember: [] }, 'the pick is the coin already pushed');
  assert.deepEqual(savedPostStep(ITEM, SAVED, [], coin('THIRD', '2026-10-23T23:50:00Z'), { first: 'DUD', running: true }, now, MAX_AGE, false), { push: null, remember: [] }, 'never a third push');
  assert.deepEqual(savedPostStep(ITEM, SAVED, [], coin('OFF', '2026-10-23T22:47:15Z', { venueId: null }), first, now, MAX_AGE, false).push, null, 'the gate holds for the second push too');
});

test('★ a pick that came before any first push settles the post: pushed if it launched after the save, else remembered silently', () => {
  const now = Date.parse('2026-10-23T23:54:00Z');
  const ties = [coin('DUD', '2026-10-23T23:50:00Z')];
  assert.deepEqual(savedPostStep(ITEM, SAVED, ties, coin('KURIBO', '2026-10-23T22:47:15Z'), NONE, now, MAX_AGE, false).push, { kind: 'first', address: 'KURIBO' });
  const settled = savedPostStep(ITEM, SAVED, ties, coin('EARLY', '2026-10-23T10:14:10Z'), NONE, now, MAX_AGE, false);
  assert.equal(settled.push, null, 'the running coin was there before the save: a later dud is not announced over it');
  assert.deepEqual(settled.remember, [firstSavedKey(ITEM, 'EARLY')]);
});

test('a first coin tied hours after its launch is remembered as the first, not announced as just launched', () => {
  const s = savedPostStep(ITEM, SAVED, [coin('LATE', '2026-10-23T18:00:00Z')], null, NONE, Date.parse('2026-10-23T22:00:00Z'), MAX_AGE, false);
  assert.equal(s.push, null);
  assert.deepEqual(s.remember, [firstSavedKey(ITEM, 'LATE')]);
});

test('★ the first look remembers what every saved post already has and sends nothing', () => {
  const now = Date.parse('2026-10-23T23:54:00Z');
  assert.deepEqual(savedPostStep(ITEM, SAVED, [coin('A', '2026-10-23T22:47:15Z')], null, NONE, now, MAX_AGE, true), { push: null, remember: [firstSavedKey(ITEM, 'A')] });
  assert.deepEqual(savedPostStep(ITEM, SAVED, [], coin('K', '2026-10-23T22:47:15Z'), NONE, now, MAX_AGE, true), { push: null, remember: [firstSavedKey(ITEM, 'K'), runningSavedKey(ITEM)] });
  assert.deepEqual(savedPostStep(ITEM, SAVED, [], coin('K', '2026-10-23T22:47:15Z'), { first: 'A', running: false }, now, MAX_AGE, true), { push: null, remember: [runningSavedKey(ITEM)] });
});

test('the memory is read back from the seen keys', () => {
  assert.deepEqual(savedMemory(ITEM, new Set()), NONE);
  assert.deepEqual(savedMemory(ITEM, new Set([firstSavedKey(ITEM, 'A'), runningSavedKey(ITEM), firstSavedKey('x:1', 'B')])), { first: 'A', running: true });
});
