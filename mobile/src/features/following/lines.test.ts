import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { FeedComment, FeedItem, SuggestedPerson } from '../../shared/api/following.ts';
import { hrefFor } from '../../shared/route.ts';
import { coinLabel, mergePage, peopleFacts, solText, whereOf } from './lines.ts';

const MINT = 'FerryHorn1111111111111111111111111111111pump';
const who = { userId: 'did:privy:1', handle: 'ana', name: 'Ana', pictureUrl: null, rank: 'intern' as const };

test("a trade's SOL is the quote, said as about, and nothing when there is no amount", () => {
  assert.equal(solText('500000000'), 'about 0.5 SOL');
  assert.equal(solText('2500000000'), 'about 2.5 SOL');
  assert.equal(solText('12345678'), 'about 0.012 SOL');
  assert.equal(solText(null), null);
  assert.equal(solText('0'), null, 'never "0 SOL"');
  assert.equal(solText('-5'), null);
});

test("a coin we never saw is its address, never a made-up name", () => {
  assert.equal(coinLabel({ mint: MINT, symbol: 'FERRY', name: 'Ferry Horn', imageUrl: null }), 'FERRY');
  assert.equal(coinLabel({ mint: MINT, symbol: null, name: 'Ferry Horn', imageUrl: null }), 'Ferry Horn');
  assert.equal(coinLabel({ mint: MINT, symbol: null, name: null, imageUrl: null }), 'Ferr…pump');
});

test('a comment opens where it was said', () => {
  const base: FeedComment = { kind: 'comment', key: 'c:1', at: 0, person: who, commentId: 1, body: 'hi', likes: 0, likedByMe: false, replies: 0, on: { kind: 'coin', id: MINT, storyId: null, title: null, coin: { mint: MINT, symbol: 'FERRY', name: null, imageUrl: null } } };
  assert.equal(whereOf(base).href, hrefFor({ screen: 'token', coinId: `solana:${MINT}` }), "a coin's comment opens its token page");
  assert.equal(whereOf(base).label, 'FERRY');
  const story = whereOf({ ...base, on: { kind: 'story', id: 'st', storyId: 'st', title: 'The ferry horn', coin: null } });
  assert.equal(story.label, 'The ferry horn');
  assert.ok(story.href?.includes('st'));
  const post = whereOf({ ...base, on: { kind: 'post', id: 'x:1', storyId: null, title: null, coin: null } });
  assert.deepEqual([post.label, post.href], ['a post', null], 'a post with no narrative has nowhere to open');
});

test("someone to follow says the counts they have, and no trade count when they do not share trades", () => {
  const p: SuggestedPerson = { ...who, followers: 1, likesThisWeek: 3, tradesThisWeek: null, commentsThisWeek: 2 };
  assert.equal(peopleFacts(p), '3 likes from holders, 2 comments this week, 1 follower');
  assert.equal(peopleFacts({ ...p, tradesThisWeek: 3, likesThisWeek: 0, commentsThisWeek: 0, followers: 12 }), '3 trades this week, 12 followers');
  assert.ok(!peopleFacts({ ...p, tradesThisWeek: 0 }).includes('trade'), 'never "0 trades"');
});

test('a page adds only rows not already shown', () => {
  const t = (key: string): FeedItem => ({ kind: 'trade', key, at: 0, person: who, side: 'buy', coin: { mint: MINT, symbol: null, name: null, imageUrl: null }, quotedLamports: null, signature: null });
  assert.deepEqual(mergePage([t('a'), t('b')], [t('b'), t('c')]).map((i) => i.key), ['a', 'b', 'c']);
});
