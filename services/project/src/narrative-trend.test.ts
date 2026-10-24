/** The tab's orders per window (narrative-trend.ts): only a checked coin is read, places are positions, the order is the trend's. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { checkedCoinOf, loadTrendCoins, trendWindows, type TrendSubject } from './narrative-trend.ts';

const MIN = 60_000;
const NOW = 1_000 * 60 * MIN;
const reading = (from: number, perMin: number) => {
  const points = [];
  for (let t = from, v = 0; t <= NOW; t += 5 * MIN, v += perMin * 5) points.push({ atMs: t, reach: v });
  return { postedAtMs: from, points };
};
const subject = (id: string, perMin: number, accounts: number): TrendSubject => ({
  id,
  input: { foundAtMs: NOW - 50 * MIN, posts: Array.from({ length: accounts }, (_, i) => ({ authorKey: `${id}${i}`, sourceKey: 'x', foundAtMs: NOW - 50 * MIN, reach: reading(NOW - 50 * MIN, perMin) })) },
  coin: null,
});

test('★ only a confirmed coin or the one proven coin counts; fitting, several proven, none: not read', () => {
  assert.equal(checkedCoinOf({ kind: 'confirmed', address: 'A' }), 'A');
  assert.equal(checkedCoinOf({ kind: 'proven', addresses: ['B'] }), 'B');
  assert.equal(checkedCoinOf({ kind: 'proven', addresses: ['B', 'C'] }), null);
  assert.equal(checkedCoinOf({ kind: 'fitting', addresses: ['D'] }), null);
  assert.equal(checkedCoinOf({ kind: 'none' }), null);
});

test('every window carries views gained, new posts and a 1-based place; the board takes the first window', () => {
  const out = trendWindows([subject('slow', 10, 1), subject('fast', 500, 4)], new Map(), NOW, DEFAULT_POLICY);
  assert.deepEqual(out.order, ['fast', 'slow']);
  const fast = out.pages.get('fast') ?? [];
  assert.deepEqual(fast.map((w) => w.hours), [1, 6, 24]);
  assert.deepEqual(fast[0], { hours: 1, viewsGained: { v: 4 * 50 * 500 }, newPosts: 4, viralPosts: 0, trendingPlace: 1 }, '25k each: under the For You bar, none viral');
  assert.equal(JSON.stringify([...out.pages.values()]).includes('value'), false, 'no ordering number on the page');
});

test('no coin to read: no statement is sent', async () => {
  const db = { query: async () => { throw new Error('read'); } };
  assert.equal((await loadTrendCoins(db as never, [], NOW, [MIN])).size, 0);
});
