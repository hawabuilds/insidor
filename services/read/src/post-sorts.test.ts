/**
 * For You's Trending and Most viewed (post-sorts.ts): the gain rule is the narrative chart's, the
 * keys order posts as the header says, a short video is ranked at the policy's short-video scale
 * while its card keeps its real views, the key never reaches the reply, and the route's answers.
 * Against a fake query function; no database.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from '@insidor/contracts';
import { narrativeReach, sortOrder } from '@insidor/core';

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

test('trending: over the floor, how many times faster it gains now than before, so a post picking up passes a bigger one gaining steadily', () => {
  const floor = DEFAULT_POLICY.rising.forYouSorts.trendFloorPerMin;
  const takingOff = rankPost('up', readings(120, 5, (m) => (m < 30 ? floor * 3 : floor / 2)), NOW - 120 * MIN, 'trending', 60 * MIN, NOW);
  const steady = rankPost('steady', readings(120, 5, (m) => (m < 30 ? floor * 10 : floor * 8)), NOW - 120 * MIN, 'trending', 60 * MIN, NOW);
  const slowing = rankPost('down', readings(120, 5, (m) => (m < 30 ? floor * 20 : floor * 30)), NOW - 120 * MIN, 'trending', 60 * MIN, NOW);
  assert.ok(takingOff !== null && steady !== null && slowing !== null);
  assert.deepEqual(ranked([slowing, steady, takingOff]).map((x) => x.id), ['up', 'steady', 'down']);
  assert.ok(takingOff.key > 4 && takingOff.key < 7, 'three times the floor against half of it: about six times faster');
});

test('★ trending: a post under the floor ranks below every post over it, by its speed, whatever its ratio', () => {
  const floor = DEFAULT_POLICY.rising.forYouSorts.trendFloorPerMin;
  const tiny = rankPost('tiny', readings(120, 5, (m) => (m < 30 ? floor / 2 : floor / 50)), NOW - 120 * MIN, 'trending', 60 * MIN, NOW);
  const smaller = rankPost('smaller', readings(120, 5, (m) => (m < 30 ? floor / 4 : floor / 400)), NOW - 120 * MIN, 'trending', 60 * MIN, NOW);
  const flat = rankPost('flat', readings(120, 5, () => floor * 2), NOW - 120 * MIN, 'trending', 60 * MIN, NOW);
  /* Gained nothing before and is over the floor now: faster than any ratio. */
  const woke = rankPost('woke', readings(120, 5, (m) => (m < 30 ? floor * 2 : 0)), NOW - 120 * MIN, 'trending', 60 * MIN, NOW);
  assert.ok(tiny !== null && smaller !== null && flat !== null && woke !== null);
  assert.equal(tiny.group, 'under_floor');
  assert.deepEqual(ranked([smaller, tiny, flat, woke]).map((x) => x.id), ['woke', 'flat', 'tiny', 'smaller']);
});

test('a post not read inside the window is not on the list', () => {
  const old = [{ atMs: NOW - 5 * 60 * MIN, value: 10 }, { atMs: NOW - 4 * 60 * MIN, value: 5000 }];
  assert.equal(rankPost('x', old, null, 'most_viewed', 60 * MIN, NOW), null);
  assert.equal(rankPost('x', old, null, 'trending', 60 * MIN, NOW), null);
  assert.equal(rankPost('x', [{ atMs: NOW - MIN, value: 5000 }], null, 'most_viewed', 60 * MIN, NOW), null, 'one reading has gained nothing we can say');
});

test('★ trending: a post with no before has no trend and is listed under every post that has one, however much it gained', () => {
  const steady = rankPost('steady', readings(120, 5, () => 20), NOW - 120 * MIN, 'trending', 60 * MIN, NOW);
  /* Read twice in the last two minutes: a big gain, no first half. */
  const glimpse = rankPost('glimpse', [{ atMs: NOW - 2 * MIN, value: 10 }, { atMs: NOW - MIN, value: 500_000 }], null, 'trending', 60 * MIN, NOW);
  /* Read either side of one long gap: the same rate in both halves by construction, so no trend either. */
  const gap = rankPost('gap', [{ atMs: NOW - 70 * MIN, value: 0 }, { atMs: NOW - 2 * MIN, value: 900_000 }], null, 'trending', 60 * MIN, NOW);
  assert.ok(steady !== null && glimpse !== null && gap !== null);
  assert.deepEqual(ranked([glimpse, gap, steady]).map((x) => x.id), ['steady', 'gap', 'glimpse']);
});

test('★ freshness: a post last read 30 minutes ago or more is listed after every post read since, on both sorts', () => {
  /* Gained millions, picking up hard, and stopped being read 40 minutes ago. */
  const stopped = readings(400, 10, (m) => (m < 180 ? 9000 : 1000)).filter((r) => r.atMs <= NOW - 40 * MIN);
  /* Gains a tenth as much, read a minute ago. */
  const live = readings(400, 10, () => 300).map((r, i, all) => (i === all.length - 1 ? { ...r, atMs: NOW - MIN } : r));
  for (const [by, w] of [['most_viewed', 6 * 60 * MIN], ['most_viewed', 24 * 60 * MIN], ['trending', 6 * 60 * MIN]] as const) {
    const a = rankPost('stopped', stopped, null, by, w, NOW);
    const b = rankPost('live', live, null, by, w, NOW);
    assert.ok(a !== null && b !== null, by);
    assert.deepEqual(sortOrder([a, b], 2, true).map((x) => x.id), ['stopped', 'live'], 'read just now, the stale post would lead');
    assert.deepEqual(ranked([a, b]).map((x) => x.id), ['live', 'stopped'], `${by} ${w}`);
  }
  const edge = rankPost('edge', readings(60, 5, () => 10).map((r) => ({ ...r, atMs: r.atMs - 30 * MIN })), null, 'most_viewed', 6 * 60 * MIN, NOW);
  assert.equal(edge?.fresh, false, 'exactly 30 minutes old is stale');
});

test("the sorts count from the card's counts, the first reading's included, and fall back to its views", () => {
  assert.match(SORT_READINGS_SQL, /coalesce\(f\.payload #> '\{sheet,counts\}', f\.payload #> '\{sheet,views\}'\)/);
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
    { item_id: 'down', views: readings(120, 5, (m) => (m < 30 ? 3000 : 4500)), posted_ms: String(NOW - 120 * MIN) },
    { item_id: 'up', views: readings(120, 5, (m) => (m < 30 ? 1200 : 150)), posted_ms: String(NOW - 120 * MIN) },
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

test("★ a short video is ranked at the policy's short-video scale in Trending, raw in Most viewed, and its card keeps its real views", async () => {
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
    /* Trending is scaled; Most viewed is raw views (the owner: "keep most viewed raw for tiktok"). */
    assert.deepEqual(reply.posts.map((p) => (p as { id: string }).id), by === 'trending' ? ['text', 'video'] : ['video', 'text'], by);
    assert.equal(reply.gained['video'], Math.round(gainIn(runsOf(rows[0]?.['views'] as Reading[]).runs, NOW - (by === 'trending' ? 60 : 24 * 60) * MIN, NOW)));
  }
  /* Without the source it would have led: raw views alone. */
  const raw = ranked([rankPost('video', rows[0]?.['views'] as Reading[], null, 'most_viewed', 60 * MIN, NOW), rankPost('text', rows[1]?.['views'] as Reading[], null, 'most_viewed', 60 * MIN, NOW)].flatMap((x) => (x === null ? [] : [x])));
  assert.deepEqual(raw.map((x) => x.id), ['video', 'text']);
});
