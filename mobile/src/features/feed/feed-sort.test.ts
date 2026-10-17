import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeRisingSorted } from '../../shared/api/decode.ts';
import { fixtureRising } from '../../test-fixtures/fixtures.ts';
import { DEFAULT_CHOICE, parseChoice, windowOf } from './feed-sort.ts';

test('New is the default; Trending starts on 1h and Most viewed on 24h', () => {
  assert.equal(DEFAULT_CHOICE.sort, 'new');
  assert.equal(windowOf(DEFAULT_CHOICE), null);
  assert.equal(windowOf({ ...DEFAULT_CHOICE, sort: 'trending' }), '1h');
  assert.equal(windowOf({ ...DEFAULT_CHOICE, sort: 'most_viewed' }), '24h');
});

test('a remembered choice reads back, each sort keeping its own window', () => {
  const c = parseChoice(JSON.stringify({ sort: 'most_viewed', windows: { trending: '6h', most_viewed: '1h' } }));
  assert.deepEqual(c, { sort: 'most_viewed', windows: { trending: '6h', most_viewed: '1h' } });
});

test('anything stored that is not ours falls back, part by part', () => {
  assert.deepEqual(parseChoice(null), DEFAULT_CHOICE);
  assert.deepEqual(parseChoice('{not json'), DEFAULT_CHOICE);
  assert.deepEqual(parseChoice(JSON.stringify({ sort: 'score', windows: { trending: '2d' } })), DEFAULT_CHOICE);
  assert.equal(parseChoice(JSON.stringify({ sort: 'trending' })).windows.trending, '1h');
});

test("a ranked list keeps the server's order and drops a post with no views gained rather than showing zero", () => {
  const feed = fixtureRising('fyp') as { posts: { id: string }[] };
  const [a, b] = feed.posts;
  assert.ok(a !== undefined && b !== undefined);
  const list = decodeRisingSorted({ tick: 1, by: 'trending', window: '1h', posts: [b, a], gained: { [b.id]: 48_000 } });
  assert.deepEqual(list.posts.map((p) => p.id), [b.id]);
  assert.equal(list.gained.get(b.id), 48_000);
  assert.throws(() => decodeRisingSorted({ by: 'trending', window: '1h', posts: [], gained: { x: 1 }, score: 3 }));
});
