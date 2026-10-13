/**
 * ★ THE TOKEN PAGE'S ABOUT READ AND THE LOGO MIRROR, ON THE REAL SCHEMA (PGlite, 0059).
 *
 * What this holds: the app role's view of a coin's launch links (public.coin_link) shows only
 * read documents; GET /coin/:id/about merges the market's links with the launch ones and lists
 * the feed posts naming the coin with their evidence and narrative; and the logo mirror finds
 * the coins on screen, records what it stored, and does not ask again about a stored one.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import { dueCoins, mirrorPass } from '@insidor/project/src/coin-logos.ts';
import { SILENT } from '@insidor/read/src/log.ts';
import { handle } from '@insidor/read/src/routes.ts';
import type { Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const NOW = Date.now();
const A = 'Aaaa111111111111111111111111111111111pump';
const B = 'Bbbb111111111111111111111111111111111pump';
let db: Db;

before(async () => {
  db = await migratedDb();
  for (const address of [A, B]) {
    await db.query(
      `insert into public.asset (chain, address, asset_key, venue_id, minted_at, minted_at_source, minted_at_conf, minted_at_bound_s, symbol, name, image_uri, creator, declared_social, first_seen_at, origin)
       values ('solana', $1, $2, 'solana:pumpfun', $3, 'vendor_field', 'bounded', 300, 'JIM', 'Jimothy', 'https://creator.example/p.png', 'Creator111', '{}'::jsonb, $3, 'backfill')`,
      [address, `solana:${address}`, new Date(NOW - 3_600_000)],
    );
  }
  await db.query(
    `insert into internal.coin_metadata (asset_key, outcome, content_id, image_uri, social_link, website, chat_link, read_at) values ($1, 'read', 'cid', 'https://gw.example/ipfs/cid', 'https://x.com/jim', 'https://jim.example', 'https://t.me/jim', now())`,
    [`solana:${A}`],
  );
  await db.query(`insert into public.rising_view (feed_id, tick) values ('fyp', 1)`);
  await db.query(`insert into public.rising_row (feed_id, item_id, position, payload) values ('fyp', 'x:1', 0, $1::jsonb)`, [
    JSON.stringify({ id: 'x:1', storyId: 'st_jim', authorLabel: '@poster', sourceLabel: 'X', excerpt: 'Jimothy', permalink: 'https://x.com/poster/status/1', thumbUrl: null, postedAt: { at: NOW - 7_200_000 }, coins: { kind: 'matched', coin: { address: A }, evidence: { linksPost: true, samePicture: null, launchedAfterMs: 600_000 } } }),
  ]);
  await db.query(`insert into public.story_view (story_id, payload) values ('st_jim', $1::jsonb)`, [JSON.stringify({ id: 'st_jim', title: 'Jimothy the cat' })]);
});

const read = () => ({
  db: { query: (s: string, p: readonly unknown[]) => db.query(s, p) },
  log: SILENT,
  about: { profile: async () => ({ imageUrl: null, links: [{ kind: 'website' as const, url: 'https://market.example' }], volume24hUsd: 5_000, liquidityUsd: 900, marketCapUsd: 12_000 }), holders: async () => 321 },
});

test('★ the about read: market links first, launch links fill the gaps, and the post with its evidence and narrative', async () => {
  const reply = await handle('GET', `/coin/${encodeURIComponent(`solana:${A}`)}/about`, read());
  assert.equal(reply.status, 200);
  const body = JSON.parse(reply.body);
  assert.deepEqual(body.links.map((l: { kind: string; url: string }) => [l.kind, l.url]), [['x', 'https://x.com/jim'], ['telegram', 'https://t.me/jim'], ['website', 'https://market.example/']]);
  assert.deepEqual(body.holders, { v: 321 });
  assert.equal(body.creator, 'Creator111');
  assert.equal(body.posts.length, 1);
  assert.equal(body.posts[0].own, true);
  assert.deepEqual(body.posts[0].evidence, { linksPost: true, samePicture: null, launchedAfterMs: 600_000 });
  assert.deepEqual(body.posts[0].story, { storyId: 'st_jim', title: 'Jimothy the cat' });
});

test('a coin with no read metadata has no launch links; one we do not hold is a 404', async () => {
  const body = JSON.parse((await handle('GET', `/coin/${encodeURIComponent(`solana:${B}`)}/about`, read())).body);
  assert.deepEqual(body.links.map((l: { kind: string }) => l.kind), ['website']);
  assert.equal((await handle('GET', '/coin/solana%3AGone111111111111111111111111111111111pump/about', read())).status, 404);
});

test('★ the mirror finds the coin on screen, prefers the launch picture through our gateway, and stores it once', async () => {
  const due = await dueCoins(db, NOW);
  assert.deepEqual(due.map((c) => c.address), [A]);
  assert.equal(due[0]?.metadataImage, 'https://gw.example/ipfs/cid');
  const copied: string[] = [];
  const r = await mirrorPass({ db, nowMs: NOW, marketImages: async () => new Map(), copy: async (_a, url) => void copied.push(url), log: () => {} });
  assert.deepEqual(r, { stored: 1, none: 0, failed: 0 });
  assert.deepEqual(copied, ['https://gw.example/ipfs/cid']);
  assert.deepEqual(await dueCoins(db, NOW), []);
});
