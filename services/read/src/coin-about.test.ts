/**
 * The token page's About read: links merged in the owner's order, one per kind and never twice,
 * an outage said as a reason rather than a number, and a coin we do not hold refused.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ABOUT_SQL, coinAbout, linkKind, linkLabel, mergeLinks, POSTS_SQL } from './coin-about.ts';
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
