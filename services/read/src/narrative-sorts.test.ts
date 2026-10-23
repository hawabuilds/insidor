/**
 * The Narratives tab's lists: what is asked for is parsed strictly, the ranked sorts order by the
 * page's facts (dead and stale off Trending, an unknown gain left off Today and Week), the site
 * filter keeps only narratives with a post there, and pages are cut 20 at a time.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Row } from './queries.ts';
import { LIST_NEW_SQL, cardOf, LIST_NUMBERS_SQL, LIST_PAGES_SQL, LIST_VIEWED_SQL, createNarrativeLists, gainNow, GAIN_FRESH_MS, numbersOf, parseNarrativeList, rankNarratives, type NumbersRow } from './narrative-sorts.ts';

const NOW = Date.parse('2026-10-18T15:00:00Z');
const MIN = 60_000;

test('the ask: the sort, the offset and the site, nothing else', () => {
  assert.deepEqual(parseNarrativeList('/narratives/default/all'), { sort: 'new', offset: 0, on: null, noCoin: false });
  assert.deepEqual(parseNarrativeList('/x/all?sort=week&offset=40&on=tiktok'), { sort: 'week', offset: 40, on: 'tiktok', noCoin: false });
  assert.deepEqual(parseNarrativeList('/x/all?sort=trending&on=tiktok&coin=none'), { sort: 'trending', offset: 0, on: 'tiktok', noCoin: true });
  assert.equal(parseNarrativeList('/x/all?sort=new&coin=unsure'), null);
  assert.equal(parseNarrativeList('/x/all?sort=hot'), null);
  assert.equal(parseNarrativeList('/x/all?sort=new&offset=-1'), null);
  assert.equal(parseNarrativeList('/x/all?sort=new&offset=1.5'), null);
  assert.equal(parseNarrativeList('/x/all?sort=new&on=facebook'), null);
});

const row = (id: string, o: Partial<Record<string, unknown>> = {}): Row => ({
  story_id: id,
  dead: false,
  projected_at: new Date(NOW - 2 * MIN),
  views_total: '1000',
  speeds: null,
  day: null,
  week: null,
  on_x: true,
  on_tiktok: false,
  ...o,
});
const speeds = (now: number, before: number) => ({ now, before, posts: 2, nowBySource: { x: now } });
const nums = (rows: readonly Row[]): NumbersRow[] => rows.flatMap((r) => numbersOf(r) ?? []);

test('Trending: risers by ratio; dead, stale and unmeasured narratives are not on it', () => {
  const rows = nums([
    row('a', { speeds: speeds(1000, 500) }),
    row('b', { speeds: speeds(900, 300) }),
    row('dead', { dead: true, speeds: speeds(5000, 100) }),
    row('stale', { projected_at: new Date(NOW - 40 * MIN), speeds: speeds(5000, 100) }),
    row('unread'),
  ]);
  assert.deepEqual(rankNarratives(rows, 'trending', null, NOW), ['b', 'a']);
});

test('★ Trending with too few speeds is filled from the fresh pages\' last-hour gains (2026-10-21: empty while 19 had one)', () => {
  const rows = nums([
    row('a', { speeds: speeds(1000, 500), hour: '20' }),
    row('big', { hour: '586867' }),
    row('mid', { hour: '48254' }),
    row('dead', { dead: true, hour: '900000' }),
    row('stale', { projected_at: new Date(NOW - 40 * MIN), hour: '900000' }),
    row('unread'),
    row('flat', { hour: '0' }),
  ]);
  assert.deepEqual(rankNarratives(rows, 'trending', null, NOW), ['a', 'big', 'mid']);
  assert.deepEqual(rankNarratives(rows, 'trending', 'tiktok', NOW), [], 'the site filter holds for the fill too');
});

test('Today and Week: by the gain, a narrative that does not say is left off, never 0', () => {
  const rows = nums([row('a', { day: '500', week: '9000' }), row('b', { day: '800', week: '100' }), row('c'), row('d', { dead: true, day: '50', week: '20000' })]);
  assert.deepEqual(rankNarratives(rows, 'today', null, NOW), ['b', 'a', 'd']);
  assert.deepEqual(rankNarratives(rows, 'week', null, NOW), ['d', 'a', 'b']);
});

test('Today and Week: a page measured an hour ago or more is left off, its old day is not today', () => {
  const rows = nums([
    row('old', { day: '11503284', week: '11503284', projected_at: new Date(NOW - 4 * 24 * 60 * MIN) }),
    row('edge', { day: '9000', week: '9000', projected_at: new Date(NOW - GAIN_FRESH_MS) }),
    row('unwritten', { day: '7000', week: '7000', projected_at: null }),
    row('fresh', { day: '500', week: '600', projected_at: new Date(NOW - GAIN_FRESH_MS + MIN) }),
    row('now', { day: '400', week: '9000' }),
  ]);
  assert.deepEqual(rankNarratives(rows, 'today', null, NOW), ['fresh', 'now']);
  assert.deepEqual(rankNarratives(rows, 'week', null, NOW), ['now', 'fresh']);
  const [old, , , fresh] = rows;
  assert.equal(gainNow(old as NumbersRow, 'today', NOW), null);
  assert.equal(gainNow(fresh as NumbersRow, 'today', NOW), 500, 'the sort key is the number the card shows');
});

test('the site filter keeps only narratives with a post there', () => {
  const rows = nums([row('a', { day: '5' }), row('t', { day: '9', on_x: false, on_tiktok: true }), row('both', { day: '1', on_tiktok: true })]);
  assert.deepEqual(rankNarratives(rows, 'today', 'tiktok', NOW), ['t', 'both']);
  assert.deepEqual(rankNarratives(rows, 'today', 'x', NOW), ['a', 'both']);
});

function db(numbers: readonly Row[]) {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  return {
    calls,
    db: {
      query: async (sql: string, params: readonly unknown[] = []): Promise<Row[]> => {
        calls.push({ sql, params });
        if (sql === LIST_NUMBERS_SQL) return [...numbers];
        if (sql === LIST_PAGES_SQL) return (params[0] as string[]).map((id) => ({ story_id: id, payload: { id } }));
        if (sql === LIST_VIEWED_SQL || sql === LIST_NEW_SQL) return [{ payload: { id: 'p' } }];
        return [];
      },
    },
  };
}

test('a ranked list is cut 20 at a time from one ranking a tick', async () => {
  const many = Array.from({ length: 25 }, (_, i) => row(`n${String(i).padStart(2, '0')}`, { day: String(1000 - i) }));
  const f = db(many);
  const list = createNarrativeLists(() => NOW);
  const first = await list(f.db, 7, { sort: 'today', offset: 0, on: null, noCoin: false });
  assert.equal(first.stories.length, 20);
  assert.equal(first.next, 20);
  const second = await list(f.db, 7, { sort: 'today', offset: 20, on: null, noCoin: false });
  assert.deepEqual(second.stories, ['n20', 'n21', 'n22', 'n23', 'n24'].map((id) => ({ id })));
  assert.equal(second.next, null);
  assert.equal(f.calls.filter((c) => c.sql === LIST_NUMBERS_SQL).length, 1, 'one ranking for the tick');
});

test('New and Most viewed All page through the index with the site label', async () => {
  const f = db([]);
  const page = await createNarrativeLists(() => NOW)(f.db, 1, { sort: 'viewed', offset: 0, on: 'tiktok', noCoin: false });
  assert.deepEqual(f.calls[0]?.params, [20, 0, 'TikTok', false]);
  assert.equal(page.next, null, 'a short page is the last');
});

test('★ a list sends a narrative as its card: the page-only series, per-post views and all but one post are cut', () => {
  const page = { id: 'n1', title: 'T', postCount: 3, evidence: [{ e: 1 }, { e: 2 }, { e: 3 }], discussion: [{ d: 1 }], viewsGained: { fromMs: 1, stepMs: 1, values: [] }, viewsGainedAll: {}, postViews: [], inWindow: [], viewsTotal: { v: 9 }, topCoin: { address: 'a' } };
  assert.deepEqual(cardOf(page), { id: 'n1', title: 'T', postCount: 3, evidence: [{ e: 1 }], discussion: [], viewsTotal: { v: 9 }, topCoin: { address: 'a' } });
  assert.equal(cardOf(null), null);
});

test('★ No coin yet: only the narratives whose card says it, with the site pill, on every ranked sort', () => {
  const rows = nums([row('none', { day: '5', no_coin: true }), row('coined', { day: '9' }), row('tiktok-none', { day: '7', no_coin: true, on_x: false, on_tiktok: true })]);
  assert.deepEqual(rankNarratives(rows, 'today', null, NOW, undefined, true), ['tiktok-none', 'none']);
  assert.deepEqual(rankNarratives(rows, 'today', 'tiktok', NOW, undefined, true), ['tiktok-none']);
  assert.deepEqual(rankNarratives(rows, 'today', null, NOW), ['coined', 'tiktok-none', 'none'], 'off, every narrative');
});

test('No coin yet is its own ranking a tick, and New and Most viewed pass it to the statement', async () => {
  const f = db([row('none', { day: '5', no_coin: true }), row('coined', { day: '9' })]);
  const list = createNarrativeLists(() => NOW);
  assert.deepEqual((await list(f.db, 3, { sort: 'today', offset: 0, on: null, noCoin: true })).stories, [{ id: 'none' }]);
  assert.deepEqual((await list(f.db, 3, { sort: 'today', offset: 0, on: null, noCoin: false })).stories, [{ id: 'coined' }, { id: 'none' }]);
  await list(f.db, 3, { sort: 'new', offset: 20, on: 'x', noCoin: true });
  assert.deepEqual(f.calls.at(-1)?.params, [20, 20, 'X', true]);
});
