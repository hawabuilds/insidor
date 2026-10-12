/**
 * The For You and Popular feeds on the phone: the decoder enforces the coin rule a second
 * time, and the sample feeds follow the server's own rule.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { WireLeakError, decodeRisingFeed, decodeRisingPost } from './decode.ts';
import { fixtureBoard, fixtureRising } from '../../test-fixtures/fixtures.ts';

const COIN = {
  coinId: 'solana:abc', ticker: 'DOCK', name: 'dock', address: 'abc', venueLabel: 'Pump.fun', imageUrl: null,
  mintedAt: { at: 1 }, priceUsd: { v: 0.001 }, marketCapUsd: { v: 40_000 }, marketCapBasis: 'fully-diluted',
  liquidityUsd: { v: null, why: 'not_reported' }, priceChange24h: { v: 0.1 }, tradable: true,
};

const POST = {
  id: 'x:1', sourceLabel: 'X', authorLabel: '@hippofan', permalink: 'https://x.com/hippofan/status/1',
  excerpt: 'moo deng yawning', thumbUrl: null, postedAt: { at: 1_000 }, reach: { v: 6_200 }, readAt: { at: 2_000 },
  spark: { points: [], windowMs: 1_800_000 }, storyId: null, coins: null,
};

test('a post with no coin decodes to its facts', () => {
  const post = decodeRisingPost(POST);
  assert.equal(post.coin, null);
  assert.equal(post.storyId, null);
  assert.deepEqual(post.reach, { known: true, amount: 6_200 });
});

test('★ a confident coin decodes, with its narrative', () => {
  const post = decodeRisingPost({ ...POST, storyId: 'st_dock', coins: { kind: 'one', coin: COIN } });
  assert.equal(post.coin?.ticker, 'DOCK');
  assert.equal(post.storyId, 'st_dock');
});

test('★ an unsure, several or none link on a single post is a leak, not a quietly dropped coin', () => {
  for (const coins of [{ kind: 'unsure', claimCount: 2 }, { kind: 'several', coins: [COIN, COIN] }, { kind: 'none' }]) {
    assert.throws(() => decodeRisingPost({ ...POST, storyId: 'st_x', coins }), WireLeakError, coins.kind);
  }
});

test('★ a coin without its narrative, or a narrative without a coin, is refused too', () => {
  assert.throws(() => decodeRisingPost({ ...POST, coins: { kind: 'one', coin: COIN } }), WireLeakError);
  assert.throws(() => decodeRisingPost({ ...POST, storyId: 'st_x' }), WireLeakError);
});

test('a score on the wire is refused', () => {
  assert.throws(() => decodeRisingPost({ ...POST, score: 0.9 }), WireLeakError);
});

test('★ the sample feeds: a coin only on posts whose sample story names exactly one', () => {
  const feed = decodeRisingFeed(fixtureRising('fyp'));
  const board = decodeRisingFeed(fixtureRising('popular'));
  assert.equal(feed.posts.length, board.posts.length);
  const rows = (fixtureBoard() as { rows: { id: string; coins: { kind: string } }[] }).rows;
  for (const post of feed.posts) {
    const story = rows.find((r) => `${r.id}:post` === post.id);
    assert.ok(story);
    assert.equal(post.coin !== null, story.coins.kind === 'one', post.id);
  }
});

test('the sample For You is newest first; Popular is most views first with unknown views last', () => {
  const fyp = decodeRisingFeed(fixtureRising('fyp')).posts;
  const times = fyp.map((p) => (p.postedAt.known ? p.postedAt.at : 0));
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
  const popular = decodeRisingFeed(fixtureRising('popular')).posts;
  const known = popular.filter((p) => p.reach.known).map((p) => (p.reach.known ? p.reach.amount : 0));
  assert.deepEqual(known, [...known].sort((a, b) => b - a));
  assert.equal(popular.at(-1)?.reach.known, false);
});
