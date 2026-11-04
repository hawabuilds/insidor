/**
 * The token page's About read: links merged in the owner's order, one per kind and never twice,
 * an outage said as a reason rather than a number, and a coin we do not hold refused.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ABOUT_SQL, COIN_STORY_SQL, coinAbout, linkKind, linkLabel, mergeLinks, POSTS_SQL } from './coin-about.ts';
import type { Logger } from './log.ts';
import { ASSET_SQL } from './market.ts';
import type { Row } from './queries.ts';

const SILENT: Logger = { info: () => {}, error: () => {} } as unknown as Logger;
const MINT = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

test('★ the market\'s links first; a launch link only fills a missing kind, and the same link never twice', () => {
  const links = mergeLinks(
    [{ kind: 'x', url: 'https://twitter.com/Coin' }, { kind: 'website', url: 'https://coin.example' }, { kind: 'discord', url: 'https://discord.gg/x' }],
    ['https://x.com/coin', 'https://t.me/coinchat', 'https://other.example', null],
  );
  assert.deepEqual(links.map((l) => [l.kind, l.label]), [['x', '@Coin'], ['telegram', 't.me/coinchat'], ['website', 'coin.example']]);
});

test('a TikTok link is its own kind, plain http is dropped, and a link naming a vendor is never sent', () => {
  assert.equal(linkKind('https://www.tiktok.com/@coin'), 'tiktok');
  assert.equal(linkKind('http://coin.example'), null);
  assert.equal(linkLabel('tiktok', 'https://www.tiktok.com/@coin'), '@coin');
  assert.deepEqual(mergeLinks([], ['https://pumpportal.fun/coin']), []);
});

function deps(answers: Record<string, readonly Row[]>, profile: () => Promise<null>, holders: (() => Promise<number | null>) | null) {
  return {
    db: { query: async (sql: string) => answers[sql] ?? [] },
    log: SILENT,
    profile,
    holders,
  };
}

test('★ a source that failed is a dash with its reason, never a zero; a coin not held is refused', async () => {
  const held = { [ASSET_SQL]: [{ chain: 'solana', address: MINT }], [ABOUT_SQL]: [{ creator: 'Creator1111', minted_at: new Date(1_000), social_link: 'https://x.com/coin', website: null, chat_link: null }], [POSTS_SQL]: [] };
  const r = await coinAbout(`solana:${MINT}`, deps(held, async () => { throw new Error('down'); }, async () => null));
  assert.ok(r);
  const body = JSON.parse(r.body);
  assert.deepEqual(body.volume24hUsd, { v: null, why: 'unreadable' });
  assert.deepEqual(body.holders, { v: null, why: 'not_reported' });
  assert.equal(body.creator, 'Creator1111');
  assert.deepEqual(body.launchedAt, { at: 1_000 });
  assert.deepEqual(body.links.map((l: { kind: string }) => l.kind), ['x']);

  assert.equal(await coinAbout(`solana:${MINT}`, deps({}, async () => null, null)), null);
});

test('each post carries its views as its card read them; a count that is missing stays missing', async () => {
  const post = (id: string, reach: unknown) => ({ item_id: id, payload: { sourceLabel: 'X', excerpt: 'post', reach }, own: true, links_post: true, same_picture: null, launched_after_ms: null, story_title: null });
  const held = { [ASSET_SQL]: [{ chain: 'solana', address: MINT }], [POSTS_SQL]: [post('x:1', { v: 751_000 }), post('x:2', { v: null, why: 'unreadable' }), post('x:3', undefined)] };
  const r = await coinAbout(`solana:${MINT}`, deps(held, async () => null, null));
  assert.ok(r);
  assert.deepEqual(JSON.parse(r.body).posts.map((p: { views: unknown }) => p.views), [{ v: 751_000 }, { v: null, why: 'not_reported' }, { v: null, why: 'not_reported' }]);
});

test('the narrative whose coin this is rides along by id, and none is null, never a guess', async () => {
  const held = { [ASSET_SQL]: [{ chain: 'solana', address: MINT }] };
  const named = await coinAbout(`solana:${MINT}`, deps({ ...held, [COIN_STORY_SQL]: [{ story_id: 'n-x:1' }] }, async () => null, null));
  assert.equal(JSON.parse(named?.body ?? '{}').storyId, 'n-x:1');
  const none = await coinAbout(`solana:${MINT}`, deps(held, async () => null, null));
  assert.equal(JSON.parse(none?.body ?? '{}').storyId, null);
});

test('★ a post whose PvP this coin is in carries the race on its evidence, for the token page\'s line', async () => {
  const race = [{ address: 'KJI', ticker: 'KJI', marketCapUsd: { v: 51_000 } }, { address: MINT, ticker: 'KIJ', marketCapUsd: { v: 12_000 } }];
  const post = { item_id: 'x:1', payload: { sourceLabel: 'X', excerpt: 'post', coins: { kind: 'matched', coin: { address: 'KJI' }, evidence: { picked: true, racingCoins: race } } }, own: false, links_post: null, same_picture: null, launched_after_ms: null, story_title: null };
  const r = await coinAbout(`solana:${MINT}`, deps({ [ASSET_SQL]: [{ chain: 'solana', address: MINT }], [POSTS_SQL]: [post] }, async () => null, null));
  assert.deepEqual(JSON.parse(r?.body ?? '{}').posts[0].evidence.racingCoins, race);
});

test('★ the post the coin links is on its page, first and marked linked, though it never made a feed ($Donkey, 2026-11-04)', async () => {
  const { linkedPostOf, withLinkedPost } = await import('./coin-about.ts');
  const linked = linkedPostOf({ item_id: 'x:2117989886926164261', body: 'JUST IN: Over $900,000,000,000 added https://t.co/abc', media: [{ uri: 'https://pbs.twimg.com/media/a.jpg', kind: 'image' }], posted_at: '2026-11-04T14:38:34Z', first_seen_at: '2026-11-04T14:39:40Z', reach: 265059, handle: 'WatcherGuru' });
  assert.ok(linked !== null);
  assert.equal(linked['permalink'], 'https://x.com/WatcherGuru/status/2117989886926164261');
  assert.equal(linked['excerpt'], 'JUST IN: Over $900,000,000,000 added', 'a trailing short link is not words');
  assert.deepEqual(linked['views'], { v: 265059 });
  assert.equal((linked['evidence'] as { linksPost: boolean }).linksPost, true);
  const shrek = { postId: 'x:1', evidence: { linksPost: false }, views: { v: 633952 } };
  assert.deepEqual(withLinkedPost([shrek], linked).map((p) => p['postId']), ['x:2117989886926164261', 'x:1']);
  /* A feed card of the linked post keeps its card, marked linked, and is not listed twice. */
  const card = { postId: 'x:2117989886926164261', excerpt: 'card words', evidence: { linksPost: false, samePicture: true } };
  const out = withLinkedPost([shrek, card], linked);
  assert.deepEqual(out.map((p) => p['postId']), ['x:2117989886926164261', 'x:1']);
  assert.equal(out[0]?.['excerpt'], 'card words');
  assert.deepEqual(out[0]?.['evidence'], { linksPost: true, samePicture: true });
  assert.equal(linkedPostOf(undefined), null);
  assert.deepEqual(withLinkedPost([shrek], null), [shrek]);
});
