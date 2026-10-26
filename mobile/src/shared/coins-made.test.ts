/**
 * A post's coins: only those made after it, and on a post's "See N coins" only its top three by
 * market cap, its own coin first (the owner, 2026-10-26, Dandy: 43 coins of the name).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SheetCoin } from './api/post-sheet.ts';
import { coinsMadeAfter, topCoinsMade } from './coins-made.ts';

const POSTED = 1_000_000_000;
const coin = (address: string, launchedAt: number, cap: number | null, proven = false): SheetCoin => ({
  coinId: `c:${address}`,
  address,
  name: 'Dandy',
  ticker: 'DANDY',
  imageUrl: null,
  launchedAt: { known: true, at: launchedAt },
  launchClock: { kind: 'unknown' },
  marketCapUsd: cap === null ? { known: false, why: 'not_reported' } : { known: true, amount: cap },
  changePct24h: { known: false, why: 'not_reported' },
  bonded: null,
  proven,
} as unknown as SheetCoin);

test('only coins made after the post', () => {
  assert.deepEqual(coinsMadeAfter([coin('OLD', POSTED - 86_400_000, 900_000), coin('NEW', POSTED + 60_000, 3_000)], POSTED).map((c) => c.address), ['NEW']);
});

test('★ the top three made after the post, highest cap first, whatever the cap; an unread cap last', () => {
  const coins = [
    coin('OLD', POSTED - 86_400_000, 900_000),
    coin('A', POSTED + 60_000, 3_300),
    coin('B', POSTED + 90_000, 1_200),
    coin('C', POSTED + 120_000, null),
    coin('D', POSTED + 150_000, 2_800),
    coin('E', POSTED + 180_000, 2_000),
  ];
  assert.deepEqual(topCoinsMade(coins, POSTED).map((c) => c.address), ['A', 'D', 'E']);
});

test('the post\'s own coin always leads the three', () => {
  const coins = [coin('A', POSTED + 60_000, 3_300), coin('MINE', POSTED + 90_000, 1_000, true), coin('D', POSTED + 150_000, 2_800), coin('E', POSTED + 180_000, 2_000)];
  assert.deepEqual(topCoinsMade(coins, POSTED).map((c) => c.address), ['MINE', 'A', 'D']);
});
