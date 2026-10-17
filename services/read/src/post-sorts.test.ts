/**
 * For You's Trending and Most viewed (post-sorts.ts): the gain rule is the narrative chart's, the
 * keys order posts as the header says, a short video is ranked at the policy's short-video scale
 * while its card keeps its real views, the key never reaches the reply, and the route's answers.
 * Against a fake query function; no database.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from '@insidor/contracts';
import { narrativeReach } from '@insidor/core';

import { SILENT } from './log.ts';
import { SORT_CARDS_SQL, SORT_READINGS_SQL, createSorts, gainIn, parseSort, rankPost, rankScale, ranked, runsOf, type Reading } from './post-sorts.ts';
import { RISING_VIEW_SQL, type Row } from './queries.ts';
import { handle } from './routes.ts';

const MIN = 60_000;
const NOW = 1_800_000_000_000;
/** Readings every `step` minutes from `fromMin` minutes ago to now, the count going by `perMin(t)` a minute. */
function readings(fromMin: number, step: number, perMin: (minAgo: number) => number, start = 1000): Reading[] {
  const out: Reading[] = [];
  let v = start;
  for (let m = fromMin; m >= 0; m -= step) {
    out.push({ atMs: NOW - m * MIN, value: Math.round(v) });
    v += perMin(m) * step;
  }
  return out;
}

test("a post's last-hour gain is the narrative chart's, reading for reading", () => {
  const cases: Reading[][] = [
    readings(180, 7, () => 40),
    readings(50, 13, (m) => (m < 20 ? 300 : 10)),
    [{ atMs: NOW - 90 * MIN, value: 100 }, { atMs: NOW - 70 * MIN, value: null }, { atMs: NOW - 30 * MIN, value: 900 }, { atMs: NOW - 20 * MIN, value: 850 }, { atMs: NOW - 10 * MIN, value: 2000 }],
  ];
  for (const r of cases) {
    const core = narrativeReach([{ postedAtMs: null, points: r.map((x) => ({ atMs: x.atMs, reach: x.value })) }], NOW, DEFAULT_POLICY);
    const ours = gainIn(runsOf(r).runs, NOW - DEFAULT_POLICY.narrative.reach.gainWindowMs, NOW);
    assert.equal(Math.round(ours), core.posts[0]?.lastHour);
  }
});

test('nothing is counted after the last reading or before the first', () => {
  const r = [{ atMs: NOW - 50 * MIN, value: 0 }, { atMs: NOW - 40 * MIN, value: 1000 }];
  assert.equal(gainIn(runsOf(r).runs, NOW - 30 * MIN, NOW), 0);
  assert.equal(gainIn(runsOf(r).runs, NOW - 45 * MIN, NOW), 500);
});

test('most viewed is views gained in the window, not lifetime views', () => {
  const huge = rankPost('a', [{ atMs: NOW - 26 * 60 * MIN, value: 0 }, { atMs: NOW - 25 * 60 * MIN, value: 9_000_000 }, { atMs: NOW - 60 * MIN, value: 9_000_100 }, { atMs: NOW, value: 9_000_200 }], null, 'most_viewed', 24 * 60 * MIN, NOW);
  const small = rankPost('b', readings(120, 10, () => 50), null, 'most_viewed', 24 * 60 * MIN, NOW);
  assert.ok(huge !== null && small !== null);
  assert.ok(small.key > huge.key);
  assert.equal(Math.round(small.gained), 6000);
});

test('trending puts a post that is picking up above a bigger one that is slowing', () => {
  const takingOff = rankPost('up', readings(120, 5, (m) => (m < 30 ? 400 : 50)), NOW - 120 * MIN, 'trending', 60 * MIN, NOW);
  const slowing = rankPost('down', readings(120, 5, (m) => (m < 30 ? 1000 : 1500)), NOW - 120 * MIN, 'trending', 60 * MIN, NOW);
  assert.ok(takingOff !== null && slowing !== null);
  assert.deepEqual(ranked([slowing, takingOff]).map((x) => x.id), ['up', 'down']);
});

test('a post not read inside the window, or read too little of its second half, is not on the list', () => {
  const old = [{ atMs: NOW - 5 * 60 * MIN, value: 10 }, { atMs: NOW - 4 * 60 * MIN, value: 5000 }];
  assert.equal(rankPost('x', old, null, 'most_viewed', 60 * MIN, NOW), null);
  assert.equal(rankPost('x', old, null, 'trending', 60 * MIN, NOW), null);
  const glimpse = [{ atMs: NOW - 2 * MIN, value: 10 }, { atMs: NOW - MIN, value: 5000 }];
  assert.equal(rankPost('x', glimpse, null, 'trending', 60 * MIN, NOW), null);
});

test('the window defaults by sort and junk is refused', () => {
  assert.deepEqual(parseSort('/rising/fyp/sorted?by=trending'), { by: 'trending', window: '1h' });
  assert.deepEqual(parseSort('/rising/fyp/sorted?by=most_viewed'), { by: 'most_viewed', window: '24h' });
  assert.deepEqual(parseSort('/rising/fyp/sorted?by=trending&window=6h'), { by: 'trending', window: '6h' });
  assert.equal(parseSort('/rising/fyp/sorted?by=score'), null);
  assert.equal(parseSort('/rising/fyp/sorted?by=trending&window=2d'), null);
});

function fakeDb(rows: readonly Row[], calls: string[] = []) {
  return {
    query: async (sql: string, params: readonly unknown[]): Promise<readonly Row[]> => {
      calls.push(sql);
      if (sql === RISING_VIEW_SQL) return [{ tick: '7' }];
      if (sql === SORT_READINGS_SQL) return rows;
      if (sql === SORT_CARDS_SQL) return (params[0] as string[]).map((id) => ({ item_id: id, payload: { id, excerpt: id }, payload_at: new Date(NOW) }));
      return [];
    },
  };
}

test('the reply is the cards in order with each one\'s views gained, and never the key', async () => {
  const rows: Row[] = [
    { item_id: 'down', views: readings(120, 5, (m) => (m < 30 ? 1000 : 1500)), posted_ms: String(NOW - 120 * MIN) },
    { item_id: 'up', views: readings(120, 5, (m) => (m < 30 ? 400 : 50)), posted_ms: String(NOW - 120 * MIN) },
    { item_id: 'unread', views: [{ atMs: NOW - 10 * MIN, value: null }], posted_ms: null },
  ];
  const sorts = createSorts(() => NOW);
  const reply = await sorts(fakeDb(rows), 'trending', '1h');
  assert.ok(reply !== null);
  assert.deepEqual(reply.posts.map((p) => (p as { id: string }).id), ['up', 'down']);
  assert.equal(reply.gained['up'], Math.round(gainIn(runsOf(rows[1]?.['views'] as Reading[]).runs, NOW - 60 * MIN, NOW)));
  assert.ok((reply.gained['up'] ?? 0) > 10_000);
  assert.doesNotMatch(JSON.stringify(reply), /"key"|speed/i);
});

test('one read per projector run: a second ask on the same tick is answered from what was kept', async () => {
  const calls: string[] = [];
  const sorts = createSorts(() => NOW);
  const db = fakeDb([], calls);
  await sorts(db, 'most_viewed', '24h');
  await sorts(db, 'most_viewed', '24h');
  assert.equal(calls.filter((s) => s === SORT_READINGS_SQL).length, 1);
});

test('the route: 200 with the list, 400 for a sort it does not know, 404 for Popular', async () => {
  const deps = { log: SILENT, db: fakeDb([]) };
  assert.equal((await handle('GET', '/rising/fyp/sorted?by=trending&window=6h', deps)).status, 200);
  assert.equal((await handle('GET', '/rising/fyp/sorted?by=lifetime', deps)).status, 400);
  assert.equal((await handle('GET', '/rising/popular/sorted?by=trending', deps)).status, 404);
});

test("★ a short video is ranked at the policy's short-video scale, and its card keeps its real views", async () => {
  const scale = DEFAULT_POLICY.rising.shortVideoReachScale;
  assert.equal(rankScale('tiktok'), scale);
  assert.equal(rankScale('x'), 1);
  assert.equal(rankScale(null), 1);
  /* The video gains 5x the text post's raw views a minute, but under the scale it is the slower one. */
  const rows: Row[] = [
    { item_id: 'video', views: readings(120, 5, () => 5000), posted_ms: String(NOW - 120 * MIN), source: 'tiktok' },
    { item_id: 'text', views: readings(120, 5, () => 1000), posted_ms: String(NOW - 120 * MIN), source: 'x' },
  ];
  assert.ok(5000 / scale < 1000);
  for (const [by, w] of [['trending', '1h'], ['most_viewed', '24h']] as const) {
    const reply = await createSorts(() => NOW)(fakeDb(rows), by, w);
    assert.ok(reply !== null);
    assert.deepEqual(reply.posts.map((p) => (p as { id: string }).id), ['text', 'video'], by);
    assert.equal(reply.gained['video'], Math.round(gainIn(runsOf(rows[0]?.['views'] as Reading[]).runs, NOW - (by === 'trending' ? 60 : 24 * 60) * MIN, NOW)));
  }
  /* Without the source it would have led: raw views alone. */
  const raw = ranked([rankPost('video', rows[0]?.['views'] as Reading[], null, 'most_viewed', 60 * MIN, NOW), rankPost('text', rows[1]?.['views'] as Reading[], null, 'most_viewed', 60 * MIN, NOW)].flatMap((x) => (x === null ? [] : [x])));
  assert.deepEqual(raw.map((x) => x.id), ['video', 'text']);
});
