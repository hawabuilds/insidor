/**
 * Which post the coin-first route takes: the original a coin's linked post points at, the bigger
 * post kept when a big account quoted a small one, a launcher's own post never taken, and an unread
 * post asked for rather than guessed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { isLauncher, resolveOrigin, type OriginFacts, type OriginLookup } from './coin-origin.ts';

const BARS = { maxDepth: 3 };

const post = (itemId: string, over: Partial<OriginFacts> = {}): OriginFacts => ({
  itemId, authorKey: `a:${itemId}`, reach: null, rebroadcastOf: null, reproductionOf: null, refersTo: [], sameMediaAs: null, launcher: false, ...over,
});

const held = (...posts: OriginFacts[]): OriginLookup => {
  const by = new Map(posts.map((p) => [p.itemId, p] as const));
  return (id) => by.get(id) ?? 'unread';
};

test('★ the Laura case: a launcher quoting the video is followed to the video, whatever the reach', () => {
  const lookup = held(
    post('x:theog', { reproductionOf: 'x:laura', reach: 3, launcher: true }),
    post('x:laura', { reach: 1_007 }),
  );
  assert.deepEqual(resolveOrigin('x:theog', lookup, BARS), { kind: 'original', itemId: 'x:laura', hops: ['quote'] });
});

test('★ the HI case: a small account quoting the baby post is followed to it (the original was seen more)', () => {
  const lookup = held(post('x:humain', { reproductionOf: 'x:prtygal', reach: 1 }), post('x:prtygal', { reach: 1_570_375 }));
  assert.deepEqual(resolveOrigin('x:humain', lookup, BARS), { kind: 'original', itemId: 'x:prtygal', hops: ['quote'] });
});

test('★ a big account quoting a small one made the post people coined: it stays', () => {
  const lookup = held(post('x:elon', { reproductionOf: 'x:analyst', reach: 9_000_000 }), post('x:analyst', { reach: 40_000 }));
  assert.deepEqual(resolveOrigin('x:elon', lookup, BARS), { kind: 'self' });
});

test('a link by URL, then a re-uploaded video, then a repost — each a hop, up to the depth', () => {
  const lookup = held(
    post('x:1', { refersTo: ['x:2'] }),
    post('x:2', { sameMediaAs: 'x:3' }),
    post('x:3', { rebroadcastOf: 'x:4' }),
    post('x:4', { reproductionOf: 'x:5' }),
    post('x:5'),
  );
  assert.deepEqual(resolveOrigin('x:1', lookup, BARS), { kind: 'original', itemId: 'x:4', hops: ['link', 'media', 'repost'] });
  assert.deepEqual(resolveOrigin('x:1', lookup, { maxDepth: 1 }), { kind: 'original', itemId: 'x:2', hops: ['link'] });
});

test('a repost is the same post: followed even to a smaller reading', () => {
  const lookup = held(post('x:rt', { rebroadcastOf: 'x:o', reach: 900 }), post('x:o', { reach: 10 }));
  assert.equal(resolveOrigin('x:rt', lookup, BARS).kind, 'original');
});

test('★ a post we do not hold is asked for, with the hops so far; one read and not returned stops the walk', () => {
  const lookup = held(post('x:p', { reproductionOf: 'x:o' }));
  assert.deepEqual(resolveOrigin('x:p', lookup, BARS), { kind: 'read', itemId: 'x:o', hops: ['quote'] });
  const gone: OriginLookup = (id) => (id === 'x:o' ? 'gone' : post('x:p', { reproductionOf: 'x:o' }));
  assert.deepEqual(resolveOrigin('x:p', gone, BARS), { kind: 'self' });
  assert.deepEqual(resolveOrigin('x:none', held(), BARS), { kind: 'read', itemId: 'x:none', hops: [] });
  assert.deepEqual(resolveOrigin('x:none', () => 'gone', BARS), { kind: 'gone' });
});

test('a post whose links were never read is read again first, unless it quotes or reposts', () => {
  assert.deepEqual(resolveOrigin('x:p', held(post('x:p', { refersTo: null })), BARS), { kind: 'read', itemId: 'x:p', hops: [] });
  const quoting = held(post('x:p', { refersTo: null, reproductionOf: 'x:o' }), post('x:o'));
  assert.equal(resolveOrigin('x:p', quoting, BARS).kind, 'original');
});

test("★ a launcher's own post with nothing to follow is only a pointer; anyone else's is the post", () => {
  assert.deepEqual(resolveOrigin('x:l', held(post('x:l', { launcher: true })), BARS), { kind: 'pointer' });
  assert.deepEqual(resolveOrigin('x:p', held(post('x:p')), BARS), { kind: 'self' });
});

test('a loop is walked once', () => {
  const lookup = held(post('x:a', { reproductionOf: 'x:b' }), post('x:b', { reproductionOf: 'x:a' }));
  assert.deepEqual(resolveOrigin('x:a', lookup, BARS), { kind: 'original', itemId: 'x:b', hops: ['quote'] });
});

test('a launcher: many coined posts, most of its posts, a small following; an unknown following is not one', () => {
  const bars = { minLinkedPosts: 20, minLinkedShare: 0.8, maxFollowers: 50_000 };
  assert.equal(isLauncher({ posts: 676, linked: 608, followers: 182 }, bars), true);
  assert.equal(isLauncher({ posts: 581, linked: 544, followers: 241_524_241 }, bars), false, 'a big account people coin');
  assert.equal(isLauncher({ posts: 10, linked: 9, followers: 100 }, bars), false, 'too few');
  assert.equal(isLauncher({ posts: 100, linked: 50, followers: 100 }, bars), false, 'not mostly');
  assert.equal(isLauncher({ posts: 100, linked: 99, followers: null }, bars), false);
});
