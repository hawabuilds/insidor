import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeSearch } from '../../shared/api/decode.ts';
import { fixtureSearch } from '../../shared/api/fixtures.ts';
import { marketLine, orderCoins, showingTop } from './search-view.ts';

const reply = (coins: readonly Record<string, unknown>[], capped = false) =>
  decodeSearch({ term: 'jim', narratives: { capped: false, items: [] }, posts: { capped: false, items: [] }, coins: { kind: 'read', capped, sourcesMissing: 0, items: coins } });

const coin = (address: string, cap: number | null, at: number | null, extra: Record<string, unknown> = {}) => ({
  coinId: `solana:${address}`, address, name: null, ticker: 'JIM', imageUrl: null,
  marketCapUsd: cap === null ? { v: null, why: 'not_reported' } : { v: cap },
  launchedAt: at === null ? { at: null, why: 'not_reported' } : { at },
  venue: 'curve', curveProgress: { v: 0.42 }, matched: null, ...extra,
});

test('★ biggest first or newest first, and an unknown goes last rather than counting as zero', () => {
  const r = reply([coin('A', 10, 3), coin('B', null, 9), coin('C', 500, 1), coin('D', 20, null)]);
  assert.equal(r.coins.kind, 'read');
  if (r.coins.kind !== 'read') return;
  assert.deepEqual(orderCoins(r.coins.items, 'cap').map((c) => c.address), ['C', 'D', 'A', 'B']);
  assert.deepEqual(orderCoins(r.coins.items, 'new').map((c) => c.address), ['B', 'A', 'C', 'D']);
});

test('a coin\'s market: on the curve with how far, bonded, or a dash for a coin no market lists', () => {
  const r = reply([coin('A', 1, 1), coin('B', 1, 1, { venue: 'pool', curveProgress: { v: 0.9 } }), coin('C', 1, 1, { venue: null })]);
  if (r.coins.kind !== 'read') return assert.fail();
  assert.deepEqual(r.coins.items.map(marketLine), ['On curve 42%', 'Bonded', '— not listed by a market yet']);
  assert.equal(r.coins.items[1]?.curveProgress, null, 'a bonded coin carries no curve progress');
});

test('"Showing top results" only when something was cut', () => {
  assert.equal(showingTop(reply([])), false);
  assert.equal(showingTop(reply([], true)), true);
});

test('★ a searched post cannot carry a narrative or a coin, whatever the server sends', () => {
  const r = decodeSearch({
    term: 'jim', narratives: { capped: false, items: [] }, coins: { kind: 'unavailable' },
    posts: { capped: false, items: [{ id: 'p', authorLabel: '@a', excerpt: 'jim', permalink: null, postedAt: { at: 1 }, live: true, storyId: 'st', coin: { ticker: 'JIM' } }] },
  });
  const [post] = r.posts.items;
  assert.equal(post !== undefined && 'storyId' in post, false);
  assert.equal(post !== undefined && 'coin' in post, false);
  assert.deepEqual(r.coins, { kind: 'unavailable' });
});

test('the sample search finds a sample story by its title, and every coin in it is that story\'s own', () => {
  const r = decodeSearch(fixtureSearch('jimothy'));
  assert.ok(r.narratives.items.length > 0);
  if (r.coins.kind !== 'read') return assert.fail();
  for (const c of r.coins.items) assert.notEqual(c.matched, null);
});

test('the sample search lists each post and each coin once, as the server does', () => {
  const r = decodeSearch(fixtureSearch('jimothy'));
  const ids = r.posts.items.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  if (r.coins.kind !== 'read') return assert.fail();
  const coins = r.coins.items.map((c) => c.coinId);
  assert.equal(new Set(coins).size, coins.length);
});
