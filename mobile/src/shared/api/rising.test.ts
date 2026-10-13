/**
 * The For You and Popular feeds on the phone: the decoder enforces the coin rule a second
 * time (no coin without its narrative), and the sample feeds follow the server's own rule.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { WireLeakError, decodeCoinLink, decodeRisingFeed, decodeRisingPost } from './decode.ts';
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

test('a post with no coin line yet (a row from before every post had one) is a dash, not "none"', () => {
  const post = decodeRisingPost(POST);
  assert.deepEqual(post.coins, { kind: 'pending' });
  assert.equal(post.storyId, null);
  assert.deepEqual(post.reach, { known: true, amount: 6_200 });
});

test('★ a confident coin decodes, with its narrative', () => {
  const post = decodeRisingPost({ ...POST, storyId: 'st_dock', coins: { kind: 'one', coin: COIN } });
  assert.equal(post.coins.kind === 'one' ? post.coins.coin.ticker : null, 'DOCK');
  assert.equal(post.storyId, 'st_dock');
});

test('searched with nothing back, searched with coins back, and not searched: three different lines', () => {
  assert.deepEqual(decodeRisingPost({ ...POST, coins: { kind: 'none' } }).coins, { kind: 'none' });
  assert.deepEqual(decodeRisingPost({ ...POST, coins: { kind: 'unsure', claimCount: 2 } }).coins, { kind: 'unsure', claimCount: 2 });
  assert.deepEqual(decodeRisingPost({ ...POST, coins: { kind: 'pending' } }).coins, { kind: 'pending' });
});

test('★ a post whose search could not finish decodes as unchecked; a narrative cannot carry it', () => {
  assert.deepEqual(decodeRisingPost({ ...POST, coins: { kind: 'unchecked' } }).coins, { kind: 'unchecked' });
  assert.throws(() => decodeCoinLink({ kind: 'unchecked' }));
});

test('★ a coin, or coins, without their narrative is a leak, not a Buy button', () => {
  assert.throws(() => decodeRisingPost({ ...POST, coins: { kind: 'one', coin: COIN } }), WireLeakError);
  assert.throws(() => decodeRisingPost({ ...POST, coins: { kind: 'several', coins: [COIN, COIN] } }), WireLeakError);
});

test('a video preview decodes with its play flag; a row from before the flag shows no play icon', () => {
  const video = decodeRisingPost({ ...POST, thumbUrl: 'https://pbs.twimg.com/amplify_video_thumb/1/img/a.jpg', thumbIsVideo: true });
  assert.equal(video.thumbUrl, 'https://pbs.twimg.com/amplify_video_thumb/1/img/a.jpg');
  assert.equal(video.thumbIsVideo, true);
  assert.equal(decodeRisingPost(POST).thumbIsVideo, false);
  assert.throws(() => decodeRisingPost({ ...POST, thumbIsVideo: 'yes' }));
});

test("the poster's picture decodes when it is an https link; absent or anything else is no picture", () => {
  assert.equal(decodeRisingPost({ ...POST, authorPictureUrl: 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg' }).authorPictureUrl, 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg');
  assert.equal(decodeRisingPost(POST).authorPictureUrl, null, 'a server from before the field');
  assert.equal(decodeRisingPost({ ...POST, authorPictureUrl: null }).authorPictureUrl, null);
  assert.equal(decodeRisingPost({ ...POST, authorPictureUrl: 'javascript:alert(1)' }).authorPictureUrl, null);
});

test('a score on the wire is refused', () => {
  assert.throws(() => decodeRisingPost({ ...POST, score: 0.9 }), WireLeakError);
});

test('★ the sample feeds: each post carries its sample story\'s coin line', () => {
  const feed = decodeRisingFeed(fixtureRising('fyp'));
  const board = decodeRisingFeed(fixtureRising('popular'));
  assert.equal(feed.posts.length, board.posts.length);
  const rows = (fixtureBoard() as { rows: { id: string; coins: { kind: string } }[] }).rows;
  for (const post of feed.posts) {
    const story = rows.find((r) => `${r.id}:post` === post.id);
    assert.ok(story);
    assert.equal(post.coins.kind, story.coins.kind, post.id);
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
