import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hrefFor, parseRoute, tabOf, type Route } from './route.ts';

const EVERY: readonly Route[] = [
  { screen: 'feed' },
  { screen: 'narratives' },
  { screen: 'search' },
  { screen: 'calls' },
  { screen: 'portfolio' },
  { screen: 'learn' },
  { screen: 'story', storyId: 'goose', sample: false },
  { screen: 'story', storyId: 'jimothy', sample: true },
  { screen: 'coin', storyId: 'jimothy', coinId: 'c1', sample: true },
  { screen: 'coin', storyId: 'a/b c', coinId: 'x%y', sample: false },
  { screen: 'token', coinId: 'solana:Abc123pump' },
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
  for (const hash of ['', '#', '#/', '#/nope', '#/story', '#/story/x/nope', '#/%zz', '#/sample/stories', '#/search/extra', '#/token', '#/token/a/b', '#/sample/token/a']) {
    assert.deepEqual(parseRoute(hash), { screen: 'feed' }, hash);
  }
});

test('a story lights the tab of the list it came from', () => {
  assert.equal(tabOf({ screen: 'story', storyId: 'x', sample: false }), 'feed');
  assert.equal(tabOf({ screen: 'coin', storyId: 'x', coinId: 'y', sample: true }), 'narratives');
});

test('a coin opened from search lights Search, where back leads', () => {
  assert.equal(tabOf({ screen: 'token', coinId: 'solana:A' }), 'search');
  assert.equal(tabOf({ screen: 'learn' }), 'portfolio', 'How Insidor works is reached from the Portfolio tab');
  assert.deepEqual(parseRoute('#/wallet'), { screen: 'portfolio' }, 'a link from before the rename still opens the tab');
});
