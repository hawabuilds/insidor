/** The infinite scroll's merge (older-feed.ts): the frame on top, each post once, nothing moved. */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { RisingPost } from '../../shared/api/index.ts';
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
