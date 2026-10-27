/**
 * An older coin listed with a post's coins (older-trading.ts): only a name the post's own tied coins
 * carry, only while it trades in a real pool. Cases from "*paws at you*", 27 Oct 2026.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { carriedNames, olderTradingCoins, type OlderCoin, type TiedCoin } from './older-trading.ts';

const BARS = { minCarriers: 2, minCapUsd: 15_000, minLiquidityUsd: 10_000, launchLeadMs: 600_000, minVariantLength: 4 };
const POSTED = 1_800_000_000_000;
const DAY = 86_400_000;

const tied = (address: string, ticker: string, ties: string[] = ['link', 'picture']): TiedCoin => ({ address, ticker, ties });
const older = (address: string, ticker: string, capUsd: number | null, liquidityUsd: number | null, launchedAtMs = POSTED - 3 * DAY, name: string | null = null): OlderCoin => ({ address, ticker, name, capUsd, liquidityUsd, launchedAtMs });

test('★ a name is carried by two or more coins tied by link or picture, never by one, never by a name tie alone', () => {
  const coins = [tied('a', 'Himmel'), tied('b', 'HIMMEL'), tied('c', 'paws'), tied('d', 'paws'), tied('e', 'mua'), tied('f', 'snep', ['name_guess', 'name_stated']), tied('g', 'snep', ['name_stated'])];
  assert.deepEqual(carriedNames(coins, BARS), ['himmel', 'paws']);
  assert.deepEqual(carriedNames([tied('a', 'Himmel'), tied('a', 'Himmel')], BARS), [], 'one coin twice is one carrier');
});

test('★ paws at you: the two 23 Oct Himmels in real pools, never the dead ones or a coin on its curve', () => {
  const coins = [
    older('4gC', 'Himmel', 75_287, 24_821, POSTED - 2.6 * DAY, 'The Snow Leopard'),
    older('B2c', 'Himmel', 21_315, 12_296, POSTED - 2.6 * DAY, 'The Snow Leopard'),
    older('AM6', 'Himmel', 2_846, 0),
    older('CURVE', 'Himmel', 40_000, null),
    older('UNREAD', 'Himmel', null, null),
    older('LEO', 'Leopard', 90_000, 30_000),
  ];
  assert.deepEqual(olderTradingCoins(POSTED, ['himmel', 'paws'], coins, BARS).map((c) => c.address), ['4gC', 'B2c']);
});

test('a coin made with the post or after it is not older; no carried name lists nothing', () => {
  const coins = [older('NEW', 'Himmel', 50_000, 20_000, POSTED - 60_000), older('OLD', 'Himmel', 50_000, 20_000)];
  assert.deepEqual(olderTradingCoins(POSTED, ['himmel'], coins, BARS).map((c) => c.address), ['OLD']);
  assert.deepEqual(olderTradingCoins(POSTED, [], coins, BARS), []);
});
