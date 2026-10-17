/** The narrative sheet: every listed post kept (readings or not), the bound, and the narrative's own coin first. */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { CoinQuote } from '@insidor/market-dexscreener';

import { createPostSheet, SHEET_COINS_SQL } from './post-sheet.ts';
import { MEMBERS_MAX, STORY_COINS_SQL, STORY_EXISTS_SQL, STORY_FOUND_SQL, STORY_MEMBERS_FRAME_SQL, STORY_MEMBERS_OF_SQL, STORY_MEMBERS_SQL } from './story-sheet.ts';
import type { Row } from './queries.ts';

const SILENT = { info: () => undefined, error: () => undefined } as never;
const quote = (cap: number): CoinQuote => ({
  name: null, ticker: null, priceUsd: null, priceSol: null, marketCapUsd: cap, liquidityUsd: null,
  change: { h1: null, h6: null, h24: null }, bonded: false,
});

function sheet(rows: Record<string, readonly Row[]>, quotes = new Map<string, CoinQuote>(), seen: unknown[][] = []) {
  return createPostSheet({
    db: { query: async (sql: string, params?: readonly unknown[]) => { seen.push([sql, params]); return rows[sql] ?? []; } },
    log: SILENT,
    quotes: { quotes: async () => quotes },
    images: null,
    keepMs: 60_000,
    now: () => 1_000,
  } as never);
}

const ONE = { kind: 'one', coin: { address: 'S', ticker: 'GTA' } };

test('★ a listed post with no projected readings stays, with no readings and no card: never a zero', async () => {
  const seen: unknown[][] = [];
  const s = sheet({
    [STORY_MEMBERS_SQL]: [
      { item_id: 'x:1', posted_at: 100, post: { id: 'x:1', sheet: { views: [{ atMs: 200, value: 50 }, { atMs: 300, value: null }] } }, listed: 2, coins: ONE },
      { item_id: 'x:2', posted_at: null, post: null, listed: 2, coins: ONE },
    ],
    [STORY_FOUND_SQL]: [{ created_at: new Date(150) }],
  }, new Map(), seen);
  const body = JSON.parse((await s.story('st_1')).body);
  assert.deepEqual(body.members.map((m: { itemId: string }) => m.itemId), ['x:1', 'x:2']);
  assert.deepEqual(body.members[0].views, [{ atMs: 200, value: 50 }, { atMs: 300, value: null }]);
  assert.deepEqual(body.members[1], { itemId: 'x:2', postedAt: { at: null, why: 'not_reported' }, post: null, views: [] });
  assert.equal(body.more, false);
  assert.deepEqual(body.foundAt, { at: 150 }, 'found is when the narrative was first grouped');
  assert.equal(seen.find((q) => q[0] === STORY_MEMBERS_SQL)?.[1]?.toString(), `st_1,${MEMBERS_MAX}`, 'the bound travels as a parameter');
});

test('the narrative\'s own coin comes first, then the other coins by market cap', async () => {
  const s = sheet({
    [STORY_MEMBERS_SQL]: [{ item_id: 'x:1', posted_at: 100, post: null, listed: 80, coins: ONE }],
    [STORY_COINS_SQL]: [{ address: 'A' }, { address: 'S' }, { address: 'B' }],
    [SHEET_COINS_SQL]: [{ address: 'A', symbol: 'AAA' }, { address: 'S', symbol: 'GTA' }, { address: 'B', symbol: 'BBB' }],
  }, new Map([['A', quote(5_000_000)], ['B', quote(9_000_000)], ['S', quote(10_000)]]));
  const body = JSON.parse((await s.story('st_1')).body);
  assert.deepEqual(body.coins.map((c: { ticker: string }) => c.ticker), ['GTA', 'BBB', 'AAA']);
  assert.equal(body.coins[0].proven, true);
  assert.equal(body.more, true, 'the page lists more than the bound');
});

test('a coin proven from one of its posts is listed, but never as the narrative\'s own', async () => {
  const s = sheet({
    [STORY_MEMBERS_SQL]: [{ item_id: 'x:1', posted_at: 100, post: { id: 'x:1', coins: { kind: 'matched', coin: { address: 'M' } } }, listed: 1, coins: { kind: 'pending' } }],
    [SHEET_COINS_SQL]: [{ address: 'M', symbol: 'MMM' }],
  });
  const body = JSON.parse((await s.story('st_1')).body);
  assert.deepEqual(body.coins.map((c: { ticker: string; proven: boolean }) => [c.ticker, c.proven]), [['MMM', false]]);
});

test('the page\'s own foundAt is the Found marker when it has one', async () => {
  const s = sheet({
    [STORY_MEMBERS_SQL]: [{ item_id: 'x:1', posted_at: 100, post: null, listed: 1, coins: { kind: 'none' }, found_at: { at: 777 } }],
    [STORY_FOUND_SQL]: [{ created_at: new Date(150) }],
  });
  assert.deepEqual(JSON.parse((await s.story('n-x:1')).body).foundAt, { at: 777 });
});

test('a story with no page is a 404; a page with no posts is an empty list', async () => {
  assert.equal((await sheet({}).story('st_gone')).status, 404);
  const body = JSON.parse((await sheet({ [STORY_EXISTS_SQL]: [{ coins: { kind: 'none' } }] }).story('st_1')).body);
  assert.deepEqual([body.members, body.coins], [[], []]);
});

test('without the infinite scroll table the frame alone is read', () => {
  assert.ok(!STORY_MEMBERS_FRAME_SQL.includes('feed_post'));
  assert.ok(STORY_MEMBERS_FRAME_SQL.includes('rising_row'));
});

test('★ the next screenful of a long narrative: only the posts asked for, bounded, no coins read', async () => {
  const seen: unknown[][] = [];
  const s = sheet({
    [STORY_MEMBERS_OF_SQL]: [{ item_id: 'x:9', posted_at: 900, post: { id: 'x:9', sheet: { views: [{ atMs: 950, value: 5 }] } }, listed: 200, coins: ONE }],
  }, new Map(), seen);
  const body = JSON.parse((await s.storyPosts('st_1', ['x:9', 'x:9', 'x:10'])).body);
  assert.deepEqual(body.members.map((m: { itemId: string }) => m.itemId), ['x:9']);
  assert.deepEqual(seen[0], [STORY_MEMBERS_OF_SQL, ['st_1', ['x:9', 'x:10'], MEMBERS_MAX]]);
  assert.ok(!seen.some(([sql]) => sql === STORY_COINS_SQL), 'no coins on a page of posts');
  assert.match(STORY_MEMBERS_OF_SQL, /= any\(\$2::text\[\]\)/);
  assert.equal((await s.storyPosts('st_1', Array.from({ length: MEMBERS_MAX + 1 }, (_, i) => `x:${i}`))).status, 400);
  assert.equal((await sheet({}).storyPosts('st_gone', ['x:1'])).status, 404);
});
