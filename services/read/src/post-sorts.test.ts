/**
 * For You's Trending and Most viewed (post-sorts.ts): the gain rule is the narrative chart's, the
 * keys order posts as the header says, a short video is ranked at the policy's short-video scale
 * while its card keeps its real views, the key never reaches the reply, and the route's answers.
 * Against a fake query function; no database.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from '@insidor/contracts';
import { narrativeReach, riserSpeeds, sortOrder, trendFloor } from '@insidor/core';

import { SILENT } from './log.ts';
import { SORT_CARDS_SQL, SORT_READINGS_SQL, SORT_VIEWED_SQL, createSorts, gainIn, parseSort, rankPost, rankScale, ranked, runsOf, type Reading } from './post-sorts.ts';
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
  const floor = trendFloor(60 * MIN, DEFAULT_POLICY);
  const takingOff = rankPost('up', readings(120, 5, (m) => (m < 30 ? floor * 3 : floor / 2)), NOW - 120 * MIN, 'trending', 60 * MIN, NOW);
  const steady = rankPost('steady', readings(120, 5, (m) => (m < 30 ? floor * 10 : floor * 8)), NOW - 120 * MIN, 'trending', 60 * MIN, NOW);
  const slowing = rankPost('down', readings(120, 5, (m) => (m < 30 ? floor * 20 : floor * 30)), NOW - 120 * MIN, 'trending', 60 * MIN, NOW);
  assert.ok(takingOff !== null && steady !== null && slowing !== null);
  assert.deepEqual(ranked([slowing, steady, takingOff]).map((x) => x.id), ['up', 'steady', 'down']);
  assert.ok(takingOff.key > 4 && takingOff.key < 7, 'three times the floor against half of it: about six times faster');
});

test('★ trending: a post under the floor ranks below every post over it, by its speed, whatever its ratio', () => {
  const floor = trendFloor(60 * MIN, DEFAULT_POLICY);
  const tiny = rankPost('tiny', readings(120, 5, (m) => (m < 30 ? floor / 2 : floor / 50)), NOW - 120 * MIN, 'trending', 60 * MIN, NOW);
  const smaller = rankPost('smaller', readings(120, 5, (m) => (m < 30 ? floor / 4 : floor / 400)), NOW - 120 * MIN, 'trending', 60 * MIN, NOW);
  const flat = rankPost('flat', readings(120, 5, () => floor * 2), NOW - 120 * MIN, 'trending', 60 * MIN, NOW);
  /* Gained nothing before and is over the floor now: faster than any ratio. */
  const woke = rankPost('woke', readings(120, 5, (m) => (m < 30 ? floor * 2 : 0)), NOW - 120 * MIN, 'trending', 60 * MIN, NOW);
  assert.ok(tiny !== null && smaller !== null && flat !== null && woke !== null);
  assert.equal(tiny.group, 'under_floor');
  assert.deepEqual(ranked([smaller, tiny, flat, woke]).map((x) => x.id), ['woke', 'flat', 'tiny', 'smaller']);
});

test('★ trending: each window has its own floor, a window with no entry takes the nearest', () => {
  const at = (perMin: number) => ({ ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, forYouSorts: { ...DEFAULT_POLICY.rising.forYouSorts, trendFloorsPerMin: [{ windowMs: 60 * MIN, perMin }, { windowMs: 24 * 60 * MIN, perMin: 10 }] } } });
  assert.equal(trendFloor(60 * MIN, at(300)), 300);
  assert.equal(trendFloor(24 * 60 * MIN, at(300)), 10);
  assert.equal(trendFloor(2 * 60 * MIN, at(300)), 300, 'nearest');
  /* The same post: over 24h's floor, under 1h's. */
  const slow = readings(26 * 60, 10, (m) => (m < 12 * 60 ? 60 : 20));
  assert.equal(rankPost('slow', slow, null, 'trending', 24 * 60 * MIN, NOW, 1, at(300))?.group, 'over_floor');
  assert.equal(rankPost('slow', slow, null, 'trending', 60 * MIN, NOW, 1, at(300))?.group, 'under_floor');
  assert.deepEqual(DEFAULT_POLICY.rising.forYouSorts.trendFloorsPerMin.map((f) => [f.windowMs / MIN, f.perMin]), [[60, 300], [360, 30], [1440, 10]]);
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

test('the window defaults by sort (Trending now, Most viewed Today), an old window is still answered, and junk is refused', () => {
  assert.deepEqual(parseSort('/rising/fyp/sorted?by=trending'), { by: 'trending', window: 'now', cursor: 0 });
  assert.deepEqual(parseSort('/rising/fyp/sorted?by=most_viewed'), { by: 'most_viewed', window: 'today', cursor: 0 });
  assert.deepEqual(parseSort('/rising/fyp/sorted?by=most_viewed&window=week&cursor=40'), { by: 'most_viewed', window: 'week', cursor: 40 });
  assert.deepEqual(parseSort('/rising/fyp/sorted?by=trending&window=6h'), { by: 'trending', window: '6h', cursor: 0 });
  assert.equal(parseSort('/rising/fyp/sorted?by=score'), null);
  assert.equal(parseSort('/rising/fyp/sorted?by=trending&window=2d'), null);
  assert.equal(parseSort('/rising/fyp/sorted?by=trending&window=week'), null, 'a span is Most viewed only');
  assert.equal(parseSort('/rising/fyp/sorted?by=most_viewed&window=now'), null);
  assert.equal(parseSort('/rising/fyp/sorted?by=most_viewed&cursor=-1'), null);
});

function fakeDb(rows: readonly Row[], calls: string[] = [], viewed: readonly Row[] = []) {
  return {
    query: async (sql: string, params: readonly unknown[]): Promise<readonly Row[]> => {
      calls.push(sql);
      if (sql === RISING_VIEW_SQL) return [{ tick: '7' }];
      if (sql === SORT_READINGS_SQL) return rows;
      if (sql === SORT_VIEWED_SQL) return viewed.filter((r) => Number(r['posted_at'] ?? r['first_seen_at']) >= Date.parse(String(params[0])));
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
  assert.equal(reply.gained?.['up'], Math.round(gainIn(runsOf(rows[1]?.['views'] as Reading[]).runs, NOW - 60 * MIN, NOW)));
  assert.ok((reply.gained?.['up'] ?? 0) > 10_000);
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
    assert.equal(reply.gained?.['video'], Math.round(gainIn(runsOf(rows[0]?.['views'] as Reading[]).runs, NOW - (by === 'trending' ? 60 : 24 * 60) * MIN, NOW)));
  }
  /* Without the source it would have led: raw views alone. */
  const raw = ranked([rankPost('video', rows[0]?.['views'] as Reading[], null, 'most_viewed', 60 * MIN, NOW), rankPost('text', rows[1]?.['views'] as Reading[], null, 'most_viewed', 60 * MIN, NOW)].flatMap((x) => (x === null ? [] : [x])));
  assert.deepEqual(raw.map((x) => x.id), ['video', 'text']);
});

/** Readings every 5 minutes for two hours: `now` a minute over the last 30 minutes, `before` a minute until then. */
const rise = (now: number, before: number, k = 1) => readings(120, 5, (m) => (m <= 30 ? now : before) * k);

test('★ Trending now: the risers first by how many times faster (30 minutes against the hour before), then, under 5 of them, the 1h rule\'s picks over its floor to 10; speeds in REAL views a minute; never the key', async () => {
  const R = DEFAULT_POLICY.rising.forYouSorts.risers;
  const floor = R.floorPerMin;
  const scale = DEFAULT_POLICY.rising.shortVideoReachScale;
  const row = (item_id: string, views: Reading[], source = 'x'): Row => ({ item_id, views, posted_ms: String(NOW - 120 * MIN), source });
  const rows: Row[] = [
    row('double', rise(floor * 2, floor)),
    row('video', rise(floor * 3, floor, scale), 'tiktok'),
    row('edge', rise(floor * 1.2, floor)),
    row('flat', rise(floor * 1.1, floor)),
    row('slowing', rise(floor * 2, floor * 4)),
    row('small', rise(floor / 2, 1)),
    /* A video gaining twice the floor in raw views: under it once scaled. */
    row('small-video', rise(floor * 2, floor / 4), 'tiktok'),
    { item_id: 'once', views: [{ atMs: NOW - 2 * MIN, value: 10 }, { atMs: NOW - MIN, value: 500_000 }], posted_ms: null, source: 'x' },
  ];
  const reply = await createSorts(() => NOW)(fakeDb(rows), 'trending', 'now');
  assert.ok(reply !== null && reply.speeds !== undefined);
  assert.deepEqual(reply.posts.map((p) => (p as { id: string }).id), ['video', 'double', 'edge', 'flat', 'slowing'], 'three risers, then the fill; small and unmeasured posts never');
  assert.deepEqual(reply.speeds['double'], { now: floor * 2, before: floor });
  assert.deepEqual(reply.speeds['video'], { now: floor * 3 * scale, before: floor * scale }, 'what the video really gained a minute');
  assert.deepEqual(reply.speeds['slowing'], { now: floor * 2, before: floor * 4 }, 'a filled card says its own slowing');
  assert.equal(reply.gained, undefined);
  assert.equal(reply.next, null);
  assert.doesNotMatch(JSON.stringify(reply), /"key"|"group"|over_floor/);
  assert.deepEqual([R.nowSpanMs / MIN, R.beforeSpanMs / MIN, R.minRatio, R.floorPerMin, R.fillBelow, R.fillTo], [30, 60, 1.15, 300, 5, 10]);
});

test('★ Trending now: 5 risers or more are the list, with no fill', async () => {
  const floor = DEFAULT_POLICY.rising.forYouSorts.risers.floorPerMin;
  const rows: Row[] = [2, 3, 4, 5, 6].map((k) => ({ item_id: `r${k}`, views: rise(floor * k, floor), posted_ms: null, source: 'x' }));
  rows.push({ item_id: 'flat', views: rise(floor * 1.1, floor), posted_ms: null, source: 'x' });
  const reply = await createSorts(() => NOW)(fakeDb(rows), 'trending', 'now');
  assert.deepEqual(reply?.posts.map((p) => (p as { id: string }).id), ['r6', 'r5', 'r4', 'r3', 'r2']);
});

test('★ Trending now: nothing fresh over the floor is an empty list', async () => {
  const flat: Row[] = [{ item_id: 'slow', views: readings(120, 5, () => 100), posted_ms: null, source: 'x' }];
  const reply = await createSorts(() => NOW)(fakeDb(flat), 'trending', 'now');
  assert.deepEqual(reply?.posts, []);
  assert.deepEqual(reply?.speeds, {});
});

test('★ a riser needs readings that measure both spans: one inside each, half of each read, no gap over 20 minutes across the mark', () => {
  const at = (min: number, value: number) => ({ atMs: NOW - min * MIN, value });
  assert.ok(riserSpeeds(rise(1000, 300).filter((r) => r.atMs >= NOW - 95 * MIN), NOW, DEFAULT_POLICY) !== null, 'read every 5 minutes');
  assert.ok(riserSpeeds([at(95, 0), at(80, 1), at(65, 2), at(50, 3), at(35, 4), at(20, 5), at(5, 6)], NOW, DEFAULT_POLICY) !== null, 'read every 15 minutes: one gap of 15 across the mark is a measurement');
  assert.equal(riserSpeeds([at(95, 0), at(50, 20_000), at(1, 60_000)], NOW, DEFAULT_POLICY), null, 'a 49-minute gap across the mark');
  assert.equal(riserSpeeds([at(50, 0), at(35, 9_000), at(25, 12_000), at(1, 60_000)], NOW, DEFAULT_POLICY), null, 'only 20 of the hour before read');
  assert.equal(riserSpeeds([at(95, 0), at(60, 9_000), at(35, 12_000), at(20, 20_000)], NOW, DEFAULT_POLICY), null, 'only 10 of the last 30 minutes read');
  /* Speed now runs to the last reading, never past it. */
  const s = riserSpeeds([at(90, 0), at(30, 6_000), at(10, 16_000)], NOW, DEFAULT_POLICY);
  assert.ok(s !== null);
  assert.equal(s.now, 500);
  assert.equal(s.before, 100);
});

test('★ Most viewed Today and This week: views GAINED in the window from each post\'s own readings, any post read in it, by views alone (31 Oct: not stale below fresh); each with its total', async () => {
  const at = (min: number, value: number) => ({ atMs: NOW - min * MIN, value });
  const rows: Row[] = [
    /* Huge, but gained little today and a lot five days ago. */
    { item_id: 'big', views: [at(6 * 24 * 60, 1_000_000), at(5 * 24 * 60, 9_000_000), at(20 * 60, 9_000_100), at(1, 9_000_200)], total: '9000200', source: 'x' },
    { item_id: 'climber', views: [at(120, 10_000), at(1, 400_000)], total: '400000', source: 'x' },
    { item_id: 'stale', views: [at(200, 0), at(40, 2_000_000)], total: '2000000', source: 'x' },
    { item_id: 'old', views: [at(3 * 24 * 60, 0), at(2 * 24 * 60, 50_000)], total: '50000', source: 'x' },
  ];
  const sorts = createSorts(() => NOW);
  const today = await sorts(fakeDb(rows), 'most_viewed', 'today');
  assert.ok(today !== null && today.gained !== undefined && today.views !== undefined);
  assert.deepEqual(today.posts.map((p) => (p as { id: string }).id), ['stale', 'climber', 'big'], 'by what each gained today, however recently it was read; old was not read today, not on Today');
  assert.equal(today.gained['climber'], 390_000);
  assert.equal(today.views['big'], 9_000_200);
  assert.equal(today.undated, 0);
  const week = await sorts(fakeDb(rows), 'most_viewed', 'week');
  assert.deepEqual(week?.posts.map((p) => (p as { id: string }).id), ['big', 'stale', 'climber', 'old'], 'by what each gained this week');
  assert.equal(week?.gained?.['big'], 8_000_200);

});

test('★ Most viewed All time: every For You post by its total, the card\'s own number, with no gain', async () => {
  const viewed: Row[] = [
    { item_id: 'a', views: '400000', read_ms: String(NOW - MIN), posted_at: new Date(NOW - 30 * 24 * 60 * MIN), first_seen_at: null },
    { item_id: 'b', views: '9000000', read_ms: String(NOW - MIN), posted_at: null, first_seen_at: null },
    { item_id: 'c', views: '700000', read_ms: String(NOW - 3 * MIN), posted_at: new Date(NOW - 60 * MIN), first_seen_at: null },
  ];
  const all = await createSorts(() => NOW)(fakeDb([], [], viewed.map((r) => ({ ...r, first_seen_at: r['first_seen_at'] ?? new Date(NOW - 99 * 24 * 60 * MIN) }))), 'most_viewed', 'all');
  assert.deepEqual(all?.posts.map((p) => (p as { id: string }).id), ['b', 'c', 'a']);
  /* ★ 31 Oct: a big post read long ago stays above a small one read just now (a 97M-view post had sunk to 88th). */
  const old: Row[] = [
    { item_id: 'huge-old', views: '97000000', read_ms: String(NOW - 10 * 24 * 60 * MIN), posted_at: new Date(NOW - 15 * 24 * 60 * MIN), first_seen_at: null },
    { item_id: 'small-new', views: '50000', read_ms: String(NOW - MIN), posted_at: new Date(NOW - 60 * MIN), first_seen_at: null },
  ];
  const ranked = await createSorts(() => NOW)(fakeDb([], [], old.map((r) => ({ ...r, first_seen_at: new Date(NOW - 99 * 24 * 60 * MIN) }))), 'most_viewed', 'all');
  assert.deepEqual(ranked?.posts.map((p) => (p as { id: string }).id), ['huge-old', 'small-new']);
  assert.equal(all?.views?.['b'], 9_000_000);
  assert.equal(all?.gained, undefined);
});

test('the new lists come a page at a time from one ranking, and say where the next page starts', async () => {
  const size = DEFAULT_POLICY.rising.forYouSorts.pageSize;
  const viewed: Row[] = Array.from({ length: size + 5 }, (_, i) => ({ item_id: `p${String(i).padStart(3, '0')}`, views: String(1_000_000 - i), read_ms: String(NOW - MIN), posted_at: new Date(NOW - 60 * MIN), first_seen_at: null }));
  const calls: string[] = [];
  const sorts = createSorts(() => NOW);
  const db = fakeDb([], calls, viewed);
  const one = await sorts(db, 'most_viewed', 'all');
  assert.equal(one?.posts.length, size);
  assert.equal(one?.next, String(size));
  const two = await sorts(db, 'most_viewed', 'all', size);
  assert.equal(two?.posts.length, 5);
  assert.equal(two?.next, null);
  assert.equal((two?.posts[0] as { id: string }).id, `p${String(size).padStart(3, '0')}`);
  assert.equal(calls.filter((s) => s === SORT_VIEWED_SQL).length, 1, 'the second page is cut from the kept ranking');
});

test('★ Trending now is ranked as of the newest reading the cards hold: a frame 20 minutes behind still lists its risers; one an hour behind lists none (2026-11-03)', async () => {
  const floor = DEFAULT_POLICY.rising.forYouSorts.risers.floorPerMin;
  const shifted = (lagMin: number) => [2, 3, 4, 5, 6].map((k) => ({ item_id: `r${k}`, views: rise(floor * k, floor).map((x) => ({ ...x, atMs: x.atMs - lagMin * MIN })), posted_ms: null, source: 'x' }));
  const behind = await createSorts(() => NOW)(fakeDb(shifted(20)), 'trending', 'now');
  assert.deepEqual(behind?.posts.map((p) => (p as { id: string }).id), ['r6', 'r5', 'r4', 'r3', 'r2']);
  const stalled = await createSorts(() => NOW)(fakeDb(shifted(60)), 'trending', 'now');
  assert.deepEqual(stalled?.posts, []);
});
