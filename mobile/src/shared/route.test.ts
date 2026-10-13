import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hrefFor, parseRoute, tabOf, type Route } from './route.ts';

const EVERY: readonly Route[] = [
  { screen: 'feed' },
  { screen: 'narratives' },
  { screen: 'search' },
  { screen: 'alerts' },
  { screen: 'portfolio' },
  { screen: 'learn' },
  { screen: 'profile', key: 'hawa' },
  { screen: 'profile', key: 'did:privy:abc' },
  { screen: 'follows', key: 'hawa', which: 'followers' },
  { screen: 'follows', key: 'hawa', which: 'following' },
  { screen: 'leaderboard' },
  { screen: 'alert-settings' },
  { screen: 'wallets' },
  { screen: 'import' },
  { screen: 'story', storyId: 'goose' },
  { screen: 'coin', storyId: 'jimothy', coinId: 'c1' },
  { screen: 'coin', storyId: 'a/b c', coinId: 'x%y' },
  { screen: 'token', coinId: 'solana:Abc123pump' },
];

test('every route survives the round trip through its own href', () => {
  for (const route of EVERY) assert.deepEqual(parseRoute(hrefFor(route)), route);
});

test('an old sample link opens the feed: there are no sample pages any more', () => {
  assert.deepEqual(parseRoute('#/sample/story/st_ferry'), { screen: 'feed' });
  assert.deepEqual(parseRoute('#/sample/story/st_ferry/coin/c_ferry'), { screen: 'feed' });
});

test('anything unreadable lands on the feed rather than an error screen', () => {
  for (const hash of ['', '#', '#/', '#/nope', '#/story', '#/story/x/nope', '#/%zz', '#/sample/stories', '#/search/extra', '#/token', '#/token/a/b', '#/sample/token/a']) {
    assert.deepEqual(parseRoute(hash), { screen: 'feed' }, hash);
  }
});

test('a story lights the tab of the list it came from', () => {
  assert.equal(tabOf({ screen: 'story', storyId: 'x' }), 'feed');
  assert.equal(tabOf({ screen: 'coin', storyId: 'x', coinId: 'y' }), 'feed');
});

test('a coin opened from search lights Search, where back leads', () => {
  assert.equal(tabOf({ screen: 'token', coinId: 'solana:A' }), 'search');
  assert.equal(tabOf({ screen: 'learn' }), 'portfolio', 'How Insidor works is reached from the Portfolio tab');
  assert.deepEqual(parseRoute('#/wallet'), { screen: 'portfolio' }, 'a link from before the rename still opens the tab');
  assert.deepEqual(parseRoute('#/calls'), { screen: 'alerts' }, 'and the old Calls link opens the Feed tab');
});

test('the Feed tab is #/feed, and every Alerts link from before the rename still opens it', () => {
  assert.equal(hrefFor({ screen: 'alerts' }), '#/feed');
  assert.equal(hrefFor({ screen: 'alert-settings' }), '#/feed/settings');
  assert.deepEqual(parseRoute('#/alerts'), { screen: 'alerts' }, 'pushes already on phones carry /#/alerts');
  assert.deepEqual(parseRoute('#/alerts/settings'), { screen: 'alert-settings' });
  assert.deepEqual(parseRoute('#/feed/nope'), { screen: 'feed' });
  for (const r of [{ screen: 'alerts' }, { screen: 'alert-settings' }] as const) assert.equal(tabOf(r), 'alerts');
});
