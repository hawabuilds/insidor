/** The infinite scroll's merge (older-feed.ts): the frame on top, each post once, nothing moved. */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { RisingPost } from '../../shared/api/index.ts';
import { newestPosted } from './feed-order.ts';
import { appendPage, bridgeReached, needsBridge, withOlder } from './older-feed.ts';

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

test('★ the frame moved on past where the pages start: the posts between are read, not lost (the owner, 2026-10-24)', () => {
  const held = [at('p1', 500), at('p2', 400)];
  assert.equal(needsBridge('f3', ['f1', 'f2', 'f3'], held), false, 'the card the pages continue is still the frame\'s: no hole');
  assert.equal(needsBridge('f3', ['n1', 'f1', 'f2', 'f3'], held), false, 'new posts above do not make one');
  assert.equal(needsBridge('f3', ['n1', 'n2', 'n3'], held), true, 'it left the frame: what was between is on no list');
  assert.equal(needsBridge('f3', ['n1'], []), false, 'no pages held: the first page starts under the new frame anyway');
  assert.equal(needsBridge(null, ['n1'], held), false);
  assert.equal(needsBridge('f3', [], held), false, 'an empty frame has no card to read under');
});

test('a bridge stops where it meets the pages held, by id or by time, and on an empty page', () => {
  const held = [at('p1', 500), at('p2', 400)];
  assert.equal(bridgeReached([at('g1', 900), at('g2', 800)], held, newestPosted), false, 'still above the pages: read on');
  assert.equal(bridgeReached([at('g3', 600), at('p1', 500)], held, newestPosted), true, 'it holds one of them');
  /* p1 was taken off For You since: no held id comes back, but the time says the hole is filled. */
  assert.equal(bridgeReached([at('g3', 600), at('g4', 450)], held, newestPosted), true);
  assert.equal(bridgeReached([], held, newestPosted), true);
  assert.equal(bridgeReached([at('g1', 900)], held, null), false, 'no order: only a held id ends it');
  const list = withOlder([at('n1', 1000)], appendPage(held, [at('g1', 900), at('g3', 600), at('p1', 500)], newestPosted), newestPosted);
  assert.deepEqual(ids(list), ['n1', 'g1', 'g3', 'p1', 'p2'], 'the bridge goes in between, in order, each post once');
});
