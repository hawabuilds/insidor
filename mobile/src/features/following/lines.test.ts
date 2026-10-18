import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { FeedComment, FeedItem, SuggestedPerson } from '../../shared/api/following.ts';
import { hrefFor } from '../../shared/route.ts';
import { coinLabel, mergePage, peopleFacts, siteOf, tradeDetail, whereOf } from './lines.ts';

const MINT = 'FerryHorn1111111111111111111111111111111pump';
const who = { userId: 'did:privy:1', handle: 'ana', name: 'Ana', pictureUrl: null, rank: 'intern' as const };

test("a trade's second line is Trador's: a buy's market cap, a sell's profit or loss, never an amount", () => {
  assert.match(tradeDetail({ side: 'buy', marketCapUsd: 48_000, outcome: null }) ?? '', /^at \$48K market cap$/);
  assert.equal(tradeDetail({ side: 'buy', marketCapUsd: null, outcome: null }), null, 'no reading that close: nothing, never a guess');
  assert.equal(tradeDetail({ side: 'sell', marketCapUsd: null, outcome: 'profit' }), 'in profit');
  assert.equal(tradeDetail({ side: 'sell', marketCapUsd: null, outcome: 'loss' }), 'at a loss');
  assert.equal(tradeDetail({ side: 'sell', marketCapUsd: null, outcome: null }), null);
});

test("a coin we never saw is its address, never a made-up name", () => {
  assert.equal(coinLabel({ mint: MINT, symbol: 'FERRY', name: 'Ferry Horn', imageUrl: null }), 'FERRY');
  assert.equal(coinLabel({ mint: MINT, symbol: null, name: 'Ferry Horn', imageUrl: null }), 'Ferry Horn');
  assert.equal(coinLabel({ mint: MINT, symbol: null, name: null, imageUrl: null }), 'Ferr…pump');
});

test('a comment opens where it was said', () => {
  const none = { pictureUrl: null, video: false, site: null, author: null };
  const base: FeedComment = { kind: 'comment', key: 'c:1', at: 0, person: who, commentId: 1, body: 'hi', likes: 0, likedByMe: false, replies: 0, on: { kind: 'coin', id: MINT, storyId: null, title: null, coin: { mint: MINT, symbol: 'FERRY', name: null, imageUrl: null }, ...none } };
  assert.equal(whereOf(base).href, hrefFor({ screen: 'token', coinId: `solana:${MINT}` }), "a coin's comment opens its token page");
  assert.equal(whereOf(base).label, 'FERRY');
  const story = whereOf({ ...base, on: { ...none, kind: 'story', id: 'st', storyId: 'st', title: 'The ferry horn', coin: null } });
  assert.deepEqual([story.label, story.href], ['The ferry horn', hrefFor({ screen: 'story', storyId: 'st' })]);
  const post = { ...base, on: { ...none, kind: 'post' as const, id: 'tiktok:1', storyId: null, title: null, coin: null, author: '@ana' } };
  assert.deepEqual([whereOf(post).label, whereOf(post).href], ['Post by @ana', hrefFor({ screen: 'post', postId: 'tiktok:1' })], 'a post opens its sheet');
  assert.equal(siteOf(post), 'tiktok', "the site from the post's id when For You never labelled it");
  assert.equal(siteOf({ ...post, on: { ...post.on, site: 'X' } }), 'x');
  assert.equal(whereOf({ ...post, on: { ...post.on, author: null } }).label, 'Post');
});

test("someone to follow says the counts they have, and no trade count when they do not share trades", () => {
  const p: SuggestedPerson = { ...who, followers: 1, likesThisWeek: 3, tradesThisWeek: null, commentsThisWeek: 2 };
  assert.equal(peopleFacts(p), '3 likes from holders, 2 comments this week, 1 follower');
  assert.equal(peopleFacts({ ...p, tradesThisWeek: 3, likesThisWeek: 0, commentsThisWeek: 0, followers: 12 }), '3 trades this week, 12 followers');
  assert.ok(!peopleFacts({ ...p, tradesThisWeek: 0 }).includes('trade'), 'never "0 trades"');
});

test('a page adds only rows not already shown', () => {
  const t = (key: string): FeedItem => ({ kind: 'trade', key, at: 0, person: who, side: 'buy', coin: { mint: MINT, symbol: null, name: null, imageUrl: null }, marketCapUsd: null, outcome: null, signature: null });
  assert.deepEqual(mergePage([t('a'), t('b')], [t('b'), t('c')]).map((i) => i.key), ['a', 'b', 'c']);
});
