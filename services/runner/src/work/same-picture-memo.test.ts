/**
 * The pass's picture-search memo answers each coin exactly as the store would, and asks the store
 * once per matched post when it can: against a stand-in store holding posts in memory.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ItemId, Millis } from '@insidor/contracts';
import type { NamingPost } from '@insidor/store';

import { samePictureMemo, type SamePictureRead } from './same-picture-memo.ts';

const DAY = 86_400_000;

/** The store's rule: posts in [since, until], earliest first, at most `limit`. */
function store(posts: readonly NamingPost[]): { read: SamePictureRead; calls: () => number } {
  let calls = 0;
  const read: SamePictureRead = async (_itemId, _space, _min, sinceMs, untilMs, limit) => {
    calls += 1;
    return posts.filter((p) => p.postedAt !== null && p.postedAt >= sinceMs && p.postedAt <= untilMs).sort((a, b) => a.postedAt! - b.postedAt!).slice(0, limit);
  };
  return { read, calls: () => calls };
}

const post = (i: number, at: number): NamingPost => ({ itemId: `x:${i}` as ItemId, postedAt: at as Millis, text: `post ${i}` });

test('★ copycat coins of one post: the store is asked once, and each coin gets the store\'s own answer', async () => {
  const posts = Array.from({ length: 6 }, (_, i) => post(i, 10 * DAY + i * DAY));
  const s = store(posts);
  const memo = samePictureMemo(s.read, (5 * DAY) as Millis);
  for (const since of [12 * DAY, 9 * DAY, 13.5 * DAY, 5 * DAY]) {
    const want = await store(posts).read('p', 'v', 0.95, since as Millis, (20 * DAY) as Millis, 20);
    assert.deepEqual(await memo('p', 'v', 0.95, since as Millis, (20 * DAY) as Millis, 20), want);
  }
  assert.equal(s.calls(), 1);
});

test('a list cut at the limit answers a later `since` only while enough of it remains', async () => {
  const posts = Array.from({ length: 10 }, (_, i) => post(i, 10 * DAY + i * DAY));
  const s = store(posts);
  const memo = samePictureMemo(s.read, (5 * DAY) as Millis);
  const until = (30 * DAY) as Millis;
  /* Held: posts 0..3 (cut at 4). From day 10 all four remain: served. */
  assert.deepEqual(await memo('p', 'v', 0.95, (10 * DAY) as Millis, until, 4), await store(posts).read('p', 'v', 0.95, (10 * DAY) as Millis, until, 4));
  assert.equal(s.calls(), 1);
  /* From day 12 only two of the four remain, and the store has more after them: asked. */
  assert.deepEqual(await memo('p', 'v', 0.95, (12 * DAY) as Millis, until, 4), await store(posts).read('p', 'v', 0.95, (12 * DAY) as Millis, until, 4));
  assert.equal(s.calls(), 2);
});

test('a different post, `until` or bar is its own search; a `since` older than the pass\'s widest is asked as it is', async () => {
  const posts = [post(1, 10 * DAY), post(2, 11 * DAY)];
  const s = store(posts);
  const memo = samePictureMemo(s.read, (5 * DAY) as Millis);
  await memo('p', 'v', 0.95, (6 * DAY) as Millis, (20 * DAY) as Millis, 20);
  await memo('q', 'v', 0.95, (6 * DAY) as Millis, (20 * DAY) as Millis, 20);
  await memo('p', 'v', 0.95, (6 * DAY) as Millis, (10.5 * DAY) as Millis, 20);
  await memo('p', 'v', 0.9, (6 * DAY) as Millis, (20 * DAY) as Millis, 20);
  assert.equal(s.calls(), 4);
  assert.deepEqual(await memo('p', 'v', 0.95, (1 * DAY) as Millis, (20 * DAY) as Millis, 20), posts);
  assert.equal(s.calls(), 5);
});
