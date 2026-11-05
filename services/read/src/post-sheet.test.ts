/** The post sheet's reply: coins by market cap with unknown caps last, the proven coin marked, media only when it plays. */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { CoinQuote } from '@insidor/market-dexscreener';

import { createPostSheet, launchClock, SHEET_COINS_SQL, SHEET_ITEM_SQL, SHEET_LIST_SQL, SHEET_POST_SQL, SHEET_QUOTED_MEDIA_SQL, SHEET_STORY_FIRST_SQL, SHEET_STORY_SQL, sheetMedia } from './post-sheet.ts';
import { QUOTE_FACES_SQL } from './quote-faces.ts';
import { PICTURE_FILES_SQL } from './post-pics.ts';
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
    [SHEET_POST_SQL]: [{ payload: POST, first_seen_at: new Date(500), media: [], display_name: 'Raw Alerts', follower_count: '1900000', picture_url: 'https://pbs.example/p.jpg', picture_copy: '0123456789abcdef0123456789abcdef' }],
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
  assert.deepEqual(body.author, { name: 'Raw Alerts', pictureUrl: 'https://pbs.example/p.jpg', pictureFile: '0123456789abcdef0123456789abcdef', followers: { v: 1_900_000 } });
  assert.deepEqual(body.foundAt, { at: 500 });
});

test('★ the post\'s trading coins (paws at you): all listed, an older one never marked proven, a tied one still is', async () => {
  const trading = (top: string, evidence: Record<string, unknown>) => ({ ...POST, coins: { kind: 'matched', coin: { address: top }, evidence: { linksPost: null, samePicture: null, launchedAfterMs: -1, ...evidence, tradingCoins: [top, 'FP4', 'HIM2'] } } });
  const rows = (payload: unknown) => ({
    [SHEET_POST_SQL]: [{ payload, media: [] }],
    [SHEET_LIST_SQL]: [{ address: 'COPY' }],
    [SHEET_COINS_SQL]: [{ address: 'HIM1', symbol: 'Himmel' }, { address: 'FP4', symbol: 'paws' }, { address: 'HIM2', symbol: 'Himmel' }, { address: 'COPY', symbol: 'paws' }],
  });
  const quotes = new Map([['HIM1', quote(75_000)], ['FP4', quote(44_000)], ['HIM2', quote(21_000)], ['COPY', quote(3_000)]]);
  const older = JSON.parse((await createPostSheet(deps(rows(trading('HIM1', {})), quotes)).sheet('x:1')).body);
  assert.deepEqual(older.coins.map((c: { address: string; proven: boolean }) => [c.address, c.proven]), [['HIM1', false], ['FP4', false], ['HIM2', false], ['COPY', false]]);
  const tied = JSON.parse((await createPostSheet(deps(rows(trading('HIM1', { picked: true })), quotes)).sheet('x:1')).body);
  assert.equal(tied.coins[0].proven, true, 'the pick is the post\'s coin, as before');
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
  const sheet = createPostSheet(deps({ [SHEET_POST_SQL]: [{ payload: { ...POST, coins: { kind: 'none' } }, media: [] }], [SHEET_STORY_SQL]: [{ story_id: 'st_1', title: 'Goliath', posts: 12 }], [SHEET_STORY_FIRST_SQL]: [{ first: 1_792_400_000_000 }] }));
  /* With when its oldest post went up, so the app lists only the coins made after it. */
  assert.deepEqual(JSON.parse((await sheet.sheet('x:1')).body).story, { storyId: 'st_1', title: 'Goliath', posts: 12, firstPostedAt: 1_792_400_000_000 });
  assert.equal(JSON.parse((await sheet.sheet('x:1')).body).storyCard, null, 'a story the board does not list gets no card');
  const listed = createPostSheet(deps({ [SHEET_POST_SQL]: [{ payload: { ...POST, coins: { kind: 'none' } }, media: [] }], [SHEET_STORY_SQL]: [{ story_id: 'st_1', title: 'Goliath', posts: 12, thumb_url: 'https://p/t.jpg', listed: true }] }));
  assert.deepEqual(JSON.parse((await listed.sheet('x:1')).body).storyCard, { storyId: 'st_1', title: 'Goliath', posts: 12, thumbUrl: 'https://p/t.jpg' });
});

test('★ our copies of the card\'s, the media\'s and the narrative card\'s pictures are named beside their links', async () => {
  const F = 'abcdefabcdefabcdefabcdefabcdef01';
  const cover = 'https://p16.example/obj/c~cover.jpeg?x-expires=1&x-signature=s';
  const sheet = createPostSheet(deps({
    [SHEET_POST_SQL]: [{ payload: { ...POST, coins: { kind: 'none' }, thumbUrl: cover }, media: [{ kind: 'video', uri: cover, durationMs: 9_000 }] }],
    [SHEET_STORY_SQL]: [{ story_id: 'st_1', title: 'Goliath', posts: 12, thumb_url: 'https://p/t.jpg', listed: true }],
    [PICTURE_FILES_SQL]: [{ link_path: 'https://p16.example/obj/c~cover.jpeg', file: F }, { link_path: 'https://p/t.jpg', file: F }],
  }));
  const body = JSON.parse((await sheet.sheet('x:1')).body);
  assert.equal(body.post.thumbFile, F);
  assert.equal(body.media.posterFile, F);
  assert.equal(body.media.posterUrl, cover, 'the link is still sent: the app falls back to it');
  assert.equal(body.storyCard.thumbFile, F);
});

test('a video is offered to play only with an https mp4 of its own; otherwise its still, and nothing when there is no picture', () => {
  assert.deepEqual(sheetMedia([{ kind: 'video', uri: 'https://p/v.jpg', durationMs: 14_000, playUri: 'https://v/a.mp4?tag=12' }])?.playUrl, 'https://v/a.mp4?tag=12');
  assert.equal(sheetMedia([{ kind: 'video', uri: 'https://p/v.jpg', durationMs: 14_000, playUri: 'https://v/a.m3u8' }])?.playUrl, null);
  assert.equal(sheetMedia([{ kind: 'image', uri: 'https://p/i.jpg' }])?.kind, 'image');
  assert.equal(sheetMedia([]), null);
  assert.equal(sheetMedia([{ kind: 'image', uri: 'http://p/i.jpg' }]), null);
});

test('a GIF goes out as a picture with a file that loops; a real video stays a video', () => {
  const gif = sheetMedia([{ kind: 'video', uri: 'https://p/g.jpg', durationMs: null, playUri: 'https://v/g.mp4', loops: true }]);
  assert.deepEqual([gif?.kind, gif?.playUrl, gif?.loops], ['image', 'https://v/g.mp4', true]);
  const older = sheetMedia([{ kind: 'video', uri: 'https://p/g.jpg', durationMs: null, playUri: 'https://v/g.mp4' }]);
  assert.deepEqual([older?.kind, older?.loops], ['image', true], 'stored before the mark: a file and no length');
  const real = sheetMedia([{ kind: 'video', uri: 'https://p/v.jpg', durationMs: 14_000, playUri: 'https://v/a.mp4' }]);
  assert.deepEqual([real?.kind, real?.loops], ['video', false]);
  const still = sheetMedia([{ kind: 'video', uri: 'https://p/v.jpg', durationMs: 14_000 }]);
  assert.deepEqual([still?.kind, still?.playUrl, still?.loops], ['video', null, false]);
});

test('★ a launch time is the chain\'s block time or not known: never the launchpad\'s stamp or a live notice', () => {
  assert.deepEqual(launchClock('chain_rpc', 1), { kind: 'chain' });
  assert.deepEqual(launchClock('issuer_api', null), { kind: 'unknown' }, 'the launchpad\'s own clock is not the block');
  assert.deepEqual(launchClock('vendor_field', 3), { kind: 'unknown' }, 'a live notice is seconds off the block, still not it');
  assert.deepEqual(launchClock('vendor_field', null), { kind: 'unknown' }, 'an aggregator pair time is not a launch time');
  assert.deepEqual(launchClock(null, null), { kind: 'unknown' }, 'a time kept after the coin row was swept');
});

test('★ a quote post with no media of its own shows the quoted post\'s, with the quoted account\'s face and our picture copy', async () => {
  const F = 'abcdefabcdefabcdefabcdefabcdef01';
  const G = '0123456789abcdef0123456789abcdef';
  const cat = 'https://pbs.twimg.com/media/cat.jpg';
  const quoted = { id: 'x:2', authorLabel: '@catowner', authorName: 'Cat Owner', permalink: 'https://x.com/catowner/status/2', excerpt: 'my cat', thumbUrl: cat, thumbIsVideo: false, postedAt: { at: 1 } };
  const sheet = createPostSheet(deps({
    [SHEET_POST_SQL]: [{ payload: { ...POST, coins: { kind: 'none' }, thumbUrl: cat, quote: quoted }, media: [] }],
    [SHEET_QUOTED_MEDIA_SQL]: [{ media: [{ kind: 'image', uri: cat, width: 900, height: 1200 }] }],
    [PICTURE_FILES_SQL]: [{ link_path: cat, file: F }],
    [QUOTE_FACES_SQL]: [{ id: 'x:2', picture_url: 'https://pbs.twimg.com/profile_images/1/me_400x400.jpg', picture_copy: G }],
  }));
  const body = JSON.parse((await sheet.sheet('x:1')).body);
  assert.equal(body.media.posterUrl, cat, 'the meme is the sheet\'s media');
  assert.equal(body.media.posterFile, F);
  assert.equal(body.post.quote.thumbFile, F);
  assert.equal(body.post.quote.authorPictureUrl, 'https://pbs.twimg.com/profile_images/1/me_400x400.jpg');
  assert.equal(body.post.quote.authorPictureFile, G);
  assert.equal(body.post.quote.excerpt, 'my cat');
});

test('★ PvP: the race\'s coins are priced on the sheet too, after the post\'s own, never marked proven', async () => {
  const payload = { ...POST, coins: { kind: 'matched', coin: { address: 'KJI' }, evidence: { linksPost: true, samePicture: null, launchedAfterMs: 1, picked: true, racing: 2, racingCoins: [{ address: 'KJI' }, { address: 'KIJ' }] } } };
  const rows = { [SHEET_POST_SQL]: [{ payload, media: [] }], [SHEET_LIST_SQL]: [], [SHEET_COINS_SQL]: [{ address: 'KJI', symbol: 'KJI' }, { address: 'KIJ', symbol: 'KIJ' }] };
  const body = JSON.parse((await createPostSheet(deps(rows, new Map([['KJI', quote(51_000)], ['KIJ', quote(12_000)]]))).sheet('x:1')).body);
  assert.deepEqual(body.coins.map((c: { address: string; proven: boolean }) => [c.address, c.proven]), [['KJI', true], ['KIJ', false]]);
});

test('★ a coin\'s own post no feed held opens from the stored post: its words, picture and last views, no coin claim (2026-11-05)', async () => {
  const item = {
    item_id: 'x:2118413834356457724', body: 'Big day for New York https://t.co/abc', media: [], posted_at: new Date(1_793_908_000_000), first_seen_at: new Date(1_793_908_009_000),
    counters: { reach: { value: 267_669, observedAt: 1_793_908_230_011 } }, handle: 'NYCMayor', display_name: 'Mayor', follower_count: '2000000', picture_url: 'https://p/a.jpg', picture_copy: null,
  };
  const r = await createPostSheet(deps({ [SHEET_ITEM_SQL]: [item] })).sheet('x:2118413834356457724');
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.deepEqual(body.post, {
    id: 'x:2118413834356457724', sourceLabel: 'X', authorLabel: '@NYCMayor', permalink: 'https://x.com/NYCMayor/status/2118413834356457724',
    excerpt: 'Big day for New York', thumbUrl: null, thumbIsVideo: false, postedAt: { at: 1_793_908_000_000 }, reach: { v: 267_669 }, readAt: { at: 1_793_908_230_011 },
    spark: { points: [], windowMs: 1_800_000 }, storyId: null, coins: { kind: 'none' }, runningOlder: [],
  });
  assert.equal(body.author.name, 'Mayor');
  assert.equal(body.media, null);
  /* A post with no reading is a dash with why, never zero. */
  const unread = JSON.parse((await createPostSheet(deps({ [SHEET_ITEM_SQL]: [{ ...item, counters: {} }] })).sheet('x:2118413834356457724')).body).post;
  assert.deepEqual([unread.reach, unread.readAt], [{ v: null, why: 'not_read_yet' }, { at: null, why: 'not_read_yet' }]);
});
