/** The narrative sheet: every listed post kept (readings or not), the bound, and the narrative's own coin first. */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { CoinQuote } from '@insidor/market-dexscreener';

import { createPostSheet, SHEET_COINS_SQL } from './post-sheet.ts';
import { MEMBERS_MAX, STORY_COINS_SQL, STORY_EXISTS_SQL, STORY_MEMBERS_FRAME_SQL, STORY_MEMBERS_SQL } from './story-sheet.ts';
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
  }, new Map(), seen);
  const body = JSON.parse((await s.story('st_1')).body);
  assert.deepEqual(body.members.map((m: { itemId: string }) => m.itemId), ['x:1', 'x:2']);
  assert.deepEqual(body.members[0].views, [{ atMs: 200, value: 50 }, { atMs: 300, value: null }]);
  assert.deepEqual(body.members[1], { itemId: 'x:2', postedAt: { at: null, why: 'not_reported' }, post: null, views: [] });
  assert.equal(body.more, false);
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

test('a story with no page is a 404; a page with no posts is an empty list', async () => {
  assert.equal((await sheet({}).story('st_gone')).status, 404);
  const body = JSON.parse((await sheet({ [STORY_EXISTS_SQL]: [{ coins: { kind: 'none' } }] }).story('st_1')).body);
  assert.deepEqual([body.members, body.coins], [[], []]);
});

test('without the infinite scroll table the frame alone is read', () => {
  assert.ok(!STORY_MEMBERS_FRAME_SQL.includes('feed_post'));
  assert.ok(STORY_MEMBERS_FRAME_SQL.includes('rising_row'));
});
