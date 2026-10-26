/**
 * For You's time for a shared post (resurfaced.ts): the share's when it is later than the post's own,
 * else the post's; and the card's share field — facts only, never sent without a handle. The fixture
 * is 2026-10-26's: @elonmusk quoting a 16-day-old video.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { StoredShare } from '@insidor/store';

import { freshForYou } from './fyp-freshness.ts';
import { forYouTime, loadShares, projectShare } from './resurfaced.ts';
import { assertNoInternalVocabulary } from './wire.ts';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const POSTED = NOW - 16 * DAY;
const SHARED = NOW - 2 * 3_600_000;

const elon: StoredShare = {
  itemId: 'x:2108694357247480087',
  byItemId: 'x:2114612551787147343',
  how: 'quoted',
  sharedAtMs: SHARED,
  handle: 'elonmusk',
  displayName: 'Elon Musk',
  source: 'x',
  sourceItemId: '2114612551787147343',
};

test('the 16-day-old video is counted from Elon\'s quote: fresh for For You now, and not once six hours have passed', () => {
  assert.equal(forYouTime(POSTED, elon), SHARED);
  assert.equal(freshForYou([], forYouTime(POSTED, elon), NOW, DEFAULT_POLICY), true);
  assert.equal(freshForYou([], forYouTime(POSTED, elon), SHARED + DEFAULT_POLICY.rising.fypMaxAgeMs + 60_000, DEFAULT_POLICY), false);
  assert.equal(freshForYou([], forYouTime(POSTED, undefined), NOW, DEFAULT_POLICY), false, 'without the share it is sixteen days old');
});

test('a share older than the post\'s own time never makes a post older', () => {
  assert.equal(forYouTime(NOW, { sharedAtMs: NOW - 1 }), NOW);
});

test('the card says who shared it, how and when, with a link to the share; no handle, no field', () => {
  const card = projectShare(elon);
  assert.deepEqual(card, {
    id: 'x:2114612551787147343',
    authorLabel: '@elonmusk',
    authorName: 'Elon Musk',
    how: 'quoted',
    at: { at: SHARED },
    permalink: card?.permalink ?? null,
  });
  assert.notEqual(card?.permalink, null);
  assertNoInternalVocabulary(card, '$.sharedBy');
  assert.equal(projectShare({ ...elon, handle: null }), null);
  assert.equal(projectShare({ ...elon, handle: '  ' }), null);
});

test('off: no share is read, so every post is counted from its own time', async () => {
  const off = { ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, resurface: { ...DEFAULT_POLICY.judge.resurface, on: false } } };
  const db = { query: async () => assert.fail('nothing is read while it is off') } as never;
  assert.equal((await loadShares(db, NOW, off)).size, 0);
});

test('before 0139 (the table missing) the frame is built as before, not failed', async () => {
  const db = { query: async () => { throw Object.assign(new Error('relation "internal.resurfacing" does not exist'), { code: '42P01' }); } } as never;
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    assert.equal((await loadShares(db, NOW, DEFAULT_POLICY)).size, 0);
  } finally {
    console.warn = warn;
  }
});
