import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { biggestFirst, groupCoins, type HistoryCoin } from './group.ts';

const P = DEFAULT_POLICY;
const coin = (address: string, over: Partial<HistoryCoin> = {}): HistoryCoin => ({
  address, name: null, ticker: null, launchedAt: null, marketCapUsd: null, linkedPost: null, ...over,
});
const sets = (n: ReturnType<typeof groupCoins>) => n.map((x) => x.coins.map((c) => c.address).sort().join(',')).sort();

test('★ a shared name alone never joins two coins; with the same ticker it does', () => {
  const coins = [
    coin('A', { name: 'Chill Guy', ticker: 'CHILL' }),
    coin('B', { name: 'chill guy!', ticker: '$chill' }),
    coin('C', { name: 'Chill Guy', ticker: 'GUY' }),
  ];
  assert.deepEqual(sets(groupCoins(coins, [], P)), ['A,B', 'C']);
});

test('the same name and a likely-same picture join; a likely picture with another name does not', () => {
  const coins = [coin('A', { name: 'Moo Deng', ticker: 'MOO' }), coin('B', { name: 'Moo Deng', ticker: 'DENG' }), coin('C', { name: 'Hippo', ticker: 'HIP' })];
  const pairs = [{ a: 'A', b: 'B', similarity: P.group.image.likely }, { a: 'A', b: 'C', similarity: P.group.image.likely }];
  assert.deepEqual(sets(groupCoins(coins, pairs, P)), ['A,B', 'C']);
});

test('the same image, or a post both creators linked, joins on its own', () => {
  const coins = [coin('A', { name: 'x' }), coin('B', { name: 'y' }), coin('C', { linkedPost: 'x:1' }), coin('D', { linkedPost: 'x:1' })];
  assert.deepEqual(sets(groupCoins(coins, [{ a: 'A', b: 'B', similarity: P.group.image.nearIdentical }], P)), ['A,B', 'C,D']);
});

test('a narrative is named by its earliest coin, and the biggest come first', () => {
  const coins = [
    coin('A', { name: 'Late', ticker: 'T', launchedAt: 20, marketCapUsd: 5 }),
    coin('B', { name: 'Late', ticker: 'T', launchedAt: 10, marketCapUsd: 1 }),
    coin('C', { name: 'Solo', ticker: 'S', launchedAt: 5, marketCapUsd: 900 }),
    coin('D', { name: 'Other', ticker: 'O', launchedAt: 5, marketCapUsd: null }),
  ];
  const n = biggestFirst(groupCoins(coins, [], P));
  assert.deepEqual(n.map((x) => x.title), ['Late', 'Solo', 'Other']);
  assert.equal(n[0]?.coins[0]?.address, 'B');
});

test('★ a same-name coin with a different picture is not grouped in', () => {
  const coins = [coin('A', { name: 'Moo Deng', ticker: 'MOODENG' }), coin('B', { name: 'Moo Deng', ticker: 'MOODENG' }), coin('C', { name: 'Moo Deng', ticker: 'MOODENG' })];
  const pairs = [
    { a: 'A', b: 'B', similarity: P.group.image.likely },
    { a: 'A', b: 'C', similarity: P.group.image.borderline - 0.01 },
    { a: 'B', b: 'C', similarity: 0 },
  ];
  assert.deepEqual(sets(groupCoins(coins, pairs, P)), ['A,B', 'C']);
});
