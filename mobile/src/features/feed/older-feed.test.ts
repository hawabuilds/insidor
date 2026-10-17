/** The infinite scroll's merge (older-feed.ts): the frame on top, each post once, nothing moved. */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { RisingPost } from '../../shared/api/index.ts';
import { newestPosted } from './feed-order.ts';
import { appendPage, withOlder } from './older-feed.ts';

const p = (id: string) => ({ id }) as RisingPost;
const ids = (rows: readonly RisingPost[]) => rows.map((r) => r.id);

test('the pages go under the frame, and a post on both shows once, where the frame has it', () => {
  assert.deepEqual(ids(withOlder([p('a'), p('b')], [p('b'), p('c'), p('d')])), ['a', 'b', 'c', 'd']);
  const head = [p('a')];
  assert.equal(withOlder(head, []), head, 'no pages: the frame as it is');
});

test('a page adds only posts not held yet, in its order', () => {
  assert.deepEqual(ids(appendPage([p('c'), p('d')], [p('d'), p('e'), p('f')])), ['c', 'd', 'e', 'f']);
});

/* For You's order (feed-order.ts): newest posted first, ties by id in byte order. */
const at = (id: string, ms: number | null) =>
  ({ id, postedAt: ms === null ? { known: false, pending: 'not_reported' } : { known: true, at: ms } }) as unknown as RisingPost;
const times = (rows: readonly RisingPost[]) => rows.map((r) => (r.postedAt.known ? r.postedAt.at : null));

test('★ For You: frame then pages is one list, newest posted first, each post once', () => {
  const frame = [at('f1', 1000), at('f2', 800), at('f3', 600)];
  /* A page read after the list changed: one card newer than the frame's last, one already shown. */
  const page1 = [at('f3', 600), at('p1', 700), at('p2', 500), at('p3', 400)];
  const page2 = [at('p4', 300), at('p5', 200)];
  const held = appendPage(appendPage([], page1, newestPosted), page2, newestPosted);
  const list = withOlder(frame, held, newestPosted);
  assert.deepEqual(ids(list), ['f1', 'f2', 'p1', 'f3', 'p2', 'p3', 'p4', 'p5']);
  const t = times(list);
  for (let i = 1; i < t.length; i += 1) assert.ok((t[i] as number) <= (t[i - 1] as number), `card ${i} is newer than the one above it`);
});

test('For You: equal times go by id in byte order, as the server sorts them', () => {
  assert.deepEqual(ids(withOlder([at('a:1', 5)], [at('X:1', 5)], newestPosted)), ['X:1', 'a:1']);
  assert.ok((newestPosted(at('X:1', 5), at('a:1', 5)) as number) < 0);
});

test('For You: a page card with no posted time goes at the end of what arrived, never guessed into a place', () => {
  assert.deepEqual(ids(withOlder([at('f1', 1000), at('f2', 800)], [at('dash', null), at('p1', 700)], newestPosted)), ['f1', 'f2', 'p1', 'dash']);
});
