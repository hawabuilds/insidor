/** The owner's screen, batched: the owner only, the first time of each kind, a failed batch kept, a missing route stops it. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { SeenPost } from '../../shared/api/owner.ts';
import { createSeenBatch, MAX_BATCH, type SendResult } from './seen.ts';

function setup(owner: boolean, results: SendResult[] = []) {
  const sent: { posts: readonly SeenPost[]; closing: boolean }[] = [];
  const state = { owner };
  const batch = createSeenBatch({
    isOwner: () => state.owner,
    send: async (posts, closing) => {
      sent.push({ posts, closing });
      return results.shift() ?? 'ok';
    },
  });
  return { batch, sent, state };
}

test('★ anyone but the owner: nothing kept, nothing sent', async () => {
  const s = setup(false);
  s.batch.onScreen('x:1', 'fyp', 1);
  s.batch.opened('x:1', 2);
  await s.batch.flush();
  assert.equal(s.sent.length, 0);
  assert.equal(s.batch.waiting(), 0);
});

test('a post seen and opened is one entry with the first time of each; once sent it is not sent again', async () => {
  const s = setup(true);
  s.batch.onScreen('x:1', 'fyp', 10);
  s.batch.onScreen('x:1', 'fyp', 20);
  s.batch.opened('x:1', 30);
  await s.batch.flush();
  assert.deepEqual(s.sent[0]?.posts, [{ itemId: 'x:1', surface: 'fyp', onScreenAt: 10, openedAt: 30 }]);
  s.batch.onScreen('x:1', 'narrative', 40);
  s.batch.opened('x:1', 50);
  await s.batch.flush();
  assert.equal(s.sent.length, 1);
});

test('★ a failed batch goes back in the queue; the one sent as the page closes is not retried', async () => {
  const s = setup(true, ['failed', 'ok']);
  s.batch.onScreen('x:1', 'fyp', 10);
  await s.batch.flush();
  assert.equal(s.batch.waiting(), 1);
  await s.batch.flush();
  assert.equal(s.sent.length, 2);
  assert.equal(s.batch.waiting(), 0);
  const c = setup(true, ['failed']);
  c.batch.onScreen('x:2', 'fyp', 10);
  await c.batch.flush(true);
  assert.equal(c.sent[0]?.closing, true);
  assert.equal(c.batch.waiting(), 0);
});

test('a server without the route, or a sign-in that is not the owner, stops the sending', async () => {
  const s = setup(true, ['gone']);
  s.batch.onScreen('x:1', 'fyp', 10);
  await s.batch.flush();
  s.batch.onScreen('x:2', 'fyp', 20);
  await s.batch.flush();
  assert.equal(s.sent.length, 1);
  assert.equal(s.batch.waiting(), 0);
});

test('a long scroll goes in requests of at most the server\'s limit', async () => {
  const s = setup(true);
  for (let i = 0; i < MAX_BATCH + 5; i++) s.batch.onScreen(`x:${i}`, 'fyp', i);
  await s.batch.flush();
  assert.deepEqual(s.sent.map((x) => x.posts.length), [MAX_BATCH, 5]);
});

test('a sign-out before the send drops what was waiting', async () => {
  const s = setup(true);
  s.batch.onScreen('x:1', 'fyp', 10);
  s.state.owner = false;
  await s.batch.flush();
  assert.equal(s.sent.length, 0);
  assert.equal(s.batch.waiting(), 0);
});
