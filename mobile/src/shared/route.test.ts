import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hrefFor, parseRoute, tabOf, type Route } from './route.ts';

const EVERY: readonly Route[] = [
  { screen: 'feed' },
  { screen: 'stories' },
  { screen: 'search' },
  { screen: 'calls' },
  { screen: 'wallet' },
  { screen: 'story', storyId: 'goose', sample: false },
  { screen: 'story', storyId: 'jimothy', sample: true },
  { screen: 'coin', storyId: 'jimothy', coinId: 'c1', sample: true },
  { screen: 'coin', storyId: 'a/b c', coinId: 'x%y', sample: false },
];

test('every route survives the round trip through its own href', () => {
  for (const route of EVERY) assert.deepEqual(parseRoute(hrefFor(route)), route);
});

test('a sample story and a read-service story with the same id are different routes', () => {
  assert.notEqual(
    hrefFor({ screen: 'story', storyId: 'x', sample: true }),
    hrefFor({ screen: 'story', storyId: 'x', sample: false }),
  );
});

test('anything unreadable lands on the feed rather than an error screen', () => {
  for (const hash of ['', '#', '#/', '#/nope', '#/story', '#/story/x/nope', '#/%zz', '#/sample/stories', '#/search/extra']) {
    assert.deepEqual(parseRoute(hash), { screen: 'feed' }, hash);
  }
});

test('a story lights the tab of the list it came from', () => {
  assert.equal(tabOf({ screen: 'story', storyId: 'x', sample: false }), 'feed');
  assert.equal(tabOf({ screen: 'coin', storyId: 'x', coinId: 'y', sample: true }), 'stories');
});
