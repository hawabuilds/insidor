/** The one push (launch.ts): a post's first pick only, only a coin launched after For You showed it, each coin once, strongest first. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { launchEvents, type Picked } from './launch.ts';

const L = DEFAULT_POLICY.notify.launch;
const MIN = 60_000;
const NOW = 1_792_500_000_000;
const ON_FYP = NOW - 60 * MIN;

const pick = (key: string, address: string, over: Partial<Picked> = {}): Picked => ({
  key, address, ticker: address.slice(0, 4), onForYouMs: ON_FYP, launchedMs: ON_FYP + 30 * MIN, capUsd: 50_000,
  itemId: key.slice(2), excerpt: 'words', author: '@a', image: null, logo: null, ...over,
});

test('★ a coin launched after the post was on For You, picked as its first coin, is pushed once', () => {
  const first = launchEvents([pick('p:x:1', 'PUMPKIN')], [], new Set(), NOW, L);
  assert.deepEqual(first.due.map((d) => d.address), ['PUMPKIN']);
  assert.deepEqual(first.keys, ['p:x:1', 'c:PUMPKIN']);
  const again = launchEvents([pick('p:x:1', 'PUMPKIN')], [], new Set(first.keys), NOW, L);
  assert.deepEqual(again.due, [], 'the same pick next pass is nothing');
});

test('★ never a hand-over: a post whose first pick was not pushed stays spent for every later coin', () => {
  /* First pick: a coin older than the post on For You (the owner: "idc about the coins that come after" is the other half). */
  const older = launchEvents([pick('p:x:2', 'OLDKIM', { launchedMs: ON_FYP - 120 * MIN })], [], new Set(), NOW, L);
  assert.deepEqual(older.due, [], 'launched before For You showed the post: not "caught early"');
  assert.deepEqual(older.keys, ['p:x:2'], 'the post is spent all the same');
  const handover = launchEvents([pick('p:x:2', 'NEWKIM')], [], new Set(older.keys), NOW, L);
  assert.deepEqual(handover.due, [], 'its later coin is a hand-over, never news');
});

test('a coin launched between the post and its first showing on For You, or of unknown launch, is not pushed', () => {
  assert.deepEqual(launchEvents([pick('p:x:3', 'A', { launchedMs: ON_FYP - 1 })], [], new Set(), NOW, L).due, []);
  assert.deepEqual(launchEvents([pick('p:x:3', 'A', { launchedMs: null })], [], new Set(), NOW, L).due, [], 'an unknown launch is no claim it came after');
  assert.equal(launchEvents([pick('p:x:3', 'A', { launchedMs: ON_FYP })], [], new Set(), NOW, L).due.length, 1, 'the same minute counts');
});

test('a pick seen long after its launch is not "just launched"', () => {
  const late = pick('p:x:4', 'BENNY', { onForYouMs: NOW - 3_000 * MIN, launchedMs: NOW - L.maxLaunchAgeMs - 1 });
  assert.deepEqual(launchEvents([late], [], new Set(), NOW, L).due, []);
  assert.equal(launchEvents([{ ...late, launchedMs: NOW - L.maxLaunchAgeMs }], [], new Set(), NOW, L).due.length, 1);
});

test('★ one coin, one push: two posts, or a post and its narrative, picking the same coin push once — the post first', () => {
  const r = launchEvents([pick('p:x:5', 'SPACEX'), pick('p:x:6', 'SPACEX')], [pick('n:n-x:5', 'SPACEX', { itemId: 'x:7' })], new Set(), NOW, L);
  assert.deepEqual(r.due.map((d) => d.key), ['p:x:5']);
  assert.deepEqual(r.keys, ['p:x:5', 'c:SPACEX', 'p:x:6', 'n:n-x:5'], 'every subject is spent, the coin once');
  const later = launchEvents([], [pick('n:n-x:9', 'SPACEX')], new Set(r.keys), NOW, L);
  assert.deepEqual(later.due, [], 'a coin pushed on an earlier pass is never pushed again');
});

test('a narrative\'s first coin is pushed when no post pushed it, about its first post on For You', () => {
  const r = launchEvents([], [pick('n:n-x:8', 'KOHEN', { itemId: 'x:8' })], new Set(), NOW, L);
  assert.deepEqual(r.due.map((d) => [d.key, d.itemId]), [['n:n-x:8', 'x:8']]);
});

test('★ the strongest first: a pass queues its coins highest market cap first, an unknown cap last', () => {
  const r = launchEvents([pick('p:a', 'SMALL', { capUsd: 18_000 }), pick('p:b', 'NONE', { capUsd: null }), pick('p:c', 'BIG', { capUsd: 1_400_000 })], [], new Set(), NOW, L);
  assert.deepEqual(r.due.map((d) => d.address), ['BIG', 'SMALL', 'NONE']);
});
