/** ★ The owner's explicit calls win over a keep, the 24 h window decides the rest, and before 0098 nothing is seen. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Db } from '../client.ts';
import { notReviewedDays, PgOwnerSeenRepo, seenOutcome } from './owner-seen.ts';

const H = 3_600_000;
const W = 24 * H;

test('★ "Not a meme" whenever tapped is not; a meme call, gold or the missed list is an explicit meme', () => {
  assert.equal(seenOutcome({ firstSeenAtMs: 0, call: 'not', listed: true }, W, 48 * H), 'not');
  assert.equal(seenOutcome({ firstSeenAtMs: 0, call: 'not', listed: false }, W, H), 'not');
  assert.equal(seenOutcome({ firstSeenAtMs: 0, call: 'meme', listed: false }, W, H), 'meme');
  assert.equal(seenOutcome({ firstSeenAtMs: 0, call: null, listed: true }, W, 48 * H), 'meme');
});

test('a post with no call is waiting inside the window and kept once it closes', () => {
  assert.equal(seenOutcome({ firstSeenAtMs: 0, call: null, listed: false }, W, W - 1), 'waiting');
  assert.equal(seenOutcome({ firstSeenAtMs: 0, call: null, listed: false }, W, W), 'kept');
});

test('before 0098 the table is missing: nothing seen, never a failed run', async () => {
  const db: Db = { query: () => Promise.reject(Object.assign(new Error('relation does not exist'), { code: '42P01' })) };
  const q = { since: new Date(0), until: new Date(W), keepWindowMs: W, now: new Date(2 * W) };
  assert.deepEqual(await new PgOwnerSeenRepo(db).seen(q), []);
  const broken: Db = { query: () => Promise.reject(Object.assign(new Error('reset'), { code: '08006' })) };
  await assert.rejects(new PgOwnerSeenRepo(broken).seen(q));
});

test('rows read back with their outcome as of now', async () => {
  const db = { query: async () => [{ item_id: 'x:1', first_at: new Date(0), on_screen: true, opened: false, call: null, listed: false, not_in_window: false }] } as unknown as Db;
  const [r] = await new PgOwnerSeenRepo(db).seen({ since: new Date(0), until: new Date(W), keepWindowMs: W, now: new Date(2 * W) });
  assert.equal(r?.outcome, 'kept');
  assert.equal((await new PgOwnerSeenRepo(db).keptIds({ since: new Date(0), until: new Date(W), keepWindowMs: W, now: new Date(2 * W) })).get('x:1'), 0);
});

const GUARD = { baselineDays: 7, minBaselineDays: 3, minSeenShare: 0.6, minNotShare: 0.4 };
/* The owner's real week, 5-12 Nov 2026: posts first seen each day, and that day's Not a meme taps. */
const WEEK = [
  { day: '2026-11-05', seen: 138, not: 50 },
  { day: '2026-11-06', seen: 146, not: 55 },
  { day: '2026-11-07', seen: 141, not: 52 },
  { day: '2026-11-08', seen: 187, not: 73 },
  { day: '2026-11-09', seen: 215, not: 60 },
  { day: '2026-11-10', seen: 166, not: 49 },
  { day: '2026-11-11', seen: 25, not: 0 },
  { day: '2026-11-12', seen: 78, not: 14 },
];

test('★ the guard leaves out the days the owner was not reviewing, and none of his normal ones', () => {
  assert.deepEqual([...notReviewedDays(WEEK, GUARD)].sort(), ['2026-11-11', '2026-11-12']);
});

test('the guard leaves nothing out without enough usual days to compare with', () => {
  assert.equal(notReviewedDays(WEEK.slice(5, 8), GUARD).size, 0);
});

test('a day as busy as usual but with almost no Not a meme taps is not reviewed', () => {
  const days = [...WEEK.slice(0, 6), { day: '2026-11-11', seen: 160, not: 5 }];
  assert.deepEqual([...notReviewedDays(days, GUARD)], ['2026-11-11']);
});

test('★ a kept post first seen inside a named not-reviewing window is no soft yes; one outside still is', async () => {
  const day = Date.parse('2026-11-10T12:00:00Z');
  const rows = [
    { item_id: 'x:before', first_at: new Date(day), on_screen: true, opened: false, call: null, listed: false, not_in_window: false },
    { item_id: 'x:inside', first_at: new Date(day + W), on_screen: true, opened: false, call: null, listed: false, not_in_window: false },
  ];
  const db = { query: async () => rows } as unknown as Db;
  const kept = await new PgOwnerSeenRepo(db).keptIds({
    since: new Date(day - H), until: new Date(day + 2 * W), keepWindowMs: W, now: new Date(day + 4 * W),
    review: { notReviewing: [{ from: '2026-11-11T00:00:00Z', until: '2026-11-14T00:00:00Z' }], guard: GUARD },
  });
  assert.deepEqual([...kept.keys()], ['x:before']);
});
