/** The post sheet's reply: coins by market cap with unknown caps last, the proven coin marked, media only when it plays. */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { CoinQuote } from '@insidor/market-dexscreener';

import { createPostSheet, SHEET_COINS_SQL, SHEET_LIST_SQL, SHEET_POST_SQL, SHEET_STORY_SQL, sheetMedia } from './post-sheet.ts';
import type { Row } from './queries.ts';

const SILENT = { info: () => undefined, error: () => undefined } as never;

const quote = (cap: number | null, bonded = false): CoinQuote => ({
  name: null, ticker: null, priceUsd: null, priceSol: null, marketCapUsd: cap, liquidityUsd: null,
  change: { h1: null, h6: null, h24: cap === null ? null : 12 }, bonded,
});

function deps(rows: Record<string, readonly Row[]>, quotes: Map<string, CoinQuote> | 'down' = new Map()) {
  return {
    db: { query: async (sql: string) => rows[sql] ?? [] },
    log: SILENT,
    quotes: { quotes: async () => { if (quotes === 'down') throw new Error('down'); return quotes; } },
    images: null,
    keepMs: 60_000,
    now: () => 1_000,
  };
}

const POST = { id: 'x:1', coins: { kind: 'matched', coin: { address: 'B', ticker: 'BEE' } }, storyId: null };

test('★ coins come highest market cap first, a coin no market lists after every one that is, and the proven coin is marked', async () => {
  const sheet = createPostSheet(deps({
    [SHEET_POST_SQL]: [{ payload: POST, first_seen_at: new Date(500), media: [], display_name: 'Raw Alerts', follower_count: '1900000', picture_url: 'https://pbs.example/p.jpg' }],
    [SHEET_LIST_SQL]: [{ address: 'B' }, { address: 'A' }, { address: 'C' }],
    [SHEET_COINS_SQL]: [{ address: 'A', symbol: 'AAA', name: 'Goliath', minted_at: new Date(100) }, { address: 'B', symbol: 'BEE', name: 'Goliath' }, { address: 'C', symbol: 'CEE', name: 'Gol' }],
  }, new Map([['A', quote(1_240_000, true)], ['B', quote(86_000)]])));
  const body = JSON.parse((await sheet.sheet('x:1')).body);
  assert.deepEqual(body.coins.map((c: { ticker: string }) => c.ticker), ['AAA', 'BEE', 'CEE']);
  assert.equal(body.coins[0].bonded, true);
  assert.equal(body.coins[1].proven, true);
  assert.deepEqual(body.coins[2].marketCapUsd, { v: null, why: 'no_market' }, 'a coin no market lists is a dash, never $0');
  assert.equal(body.coins[2].bonded, null);
  assert.equal(body.coinName, 'Goliath');
  assert.deepEqual(body.author, { name: 'Raw Alerts', pictureUrl: 'https://pbs.example/p.jpg', followers: { v: 1_900_000 } });
  assert.deepEqual(body.foundAt, { at: 500 });
});

test('an outage is not an empty market: every cap is "not read yet"', async () => {
  const sheet = createPostSheet(deps({ [SHEET_POST_SQL]: [{ payload: POST, media: [] }], [SHEET_COINS_SQL]: [{ address: 'B', symbol: 'BEE' }] }, 'down'));
  const body = JSON.parse((await sheet.sheet('x:1')).body);
  assert.deepEqual(body.coins[0].marketCapUsd, { v: null, why: 'not_read_yet' });
  assert.equal(body.sourcesMissing, 1);
  assert.equal(body.author.pictureUrl, null, 'before 0067 there is no picture, and no error');
});

test('a post no feed holds is a 404, and its narrative is named when it is in one', async () => {
  assert.equal((await createPostSheet(deps({})).sheet('x:gone')).status, 404);
  const sheet = createPostSheet(deps({ [SHEET_POST_SQL]: [{ payload: { ...POST, coins: { kind: 'none' } }, media: [] }], [SHEET_STORY_SQL]: [{ story_id: 'st_1', title: 'Goliath' }] }));
  assert.deepEqual(JSON.parse((await sheet.sheet('x:1')).body).narrative, { storyId: 'st_1', title: 'Goliath' });
});

test('a video is offered to play only with an https mp4 of its own; otherwise its still, and nothing when there is no picture', () => {
  assert.deepEqual(sheetMedia([{ kind: 'video', uri: 'https://p/v.jpg', durationMs: 14_000, playUri: 'https://v/a.mp4?tag=12' }])?.playUrl, 'https://v/a.mp4?tag=12');
  assert.equal(sheetMedia([{ kind: 'video', uri: 'https://p/v.jpg', durationMs: 14_000, playUri: 'https://v/a.m3u8' }])?.playUrl, null);
  assert.equal(sheetMedia([{ kind: 'image', uri: 'https://p/i.jpg' }])?.kind, 'image');
  assert.equal(sheetMedia([]), null);
  assert.equal(sheetMedia([{ kind: 'image', uri: 'http://p/i.jpg' }]), null);
});
