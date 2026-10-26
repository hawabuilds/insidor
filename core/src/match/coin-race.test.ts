/**
 * The race: two coins made for one post, broken away together, shown together — and nothing else.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { racingCoins, type RaceBars } from './coin-race.ts';
import type { Contender } from './one-coin.ts';

const MIN = 60_000;
const NOW = 1_000 * MIN;
const BARS: RaceBars = { windowMs: 30 * MIN, minCapUsd: 10_000, gapRatio: 1.5, size: 2, rugShareOfPeak: 0.3, creatorDumpShareOfPeak: 0.5 };
const coin = (address: string, capUsd: number, o: Partial<Contender> = {}, peak = capUsd): Contender => ({
  address,
  launchedAtMs: NOW - 2 * MIN,
  evidence: ['link'],
  trades: null,
  market: { capUsd, peakCapUsd: peak },
  ...o,
});

test('★ two coins linking the post over a field: both race, highest first (25 Oct 02:04, $Marvin)', () => {
  const field = [coin('WRONG', 53_000), coin('REAL', 22_000), coin('C3', 6_000), coin('C4', 5_000)];
  assert.deepEqual(racingCoins(field, NOW, BARS), ['WRONG', 'REAL']);
});

test('no race: the second under the bar, too close to the third, or only one coin', () => {
  assert.deepEqual(racingCoins([coin('A', 53_000), coin('B', 9_000)], NOW, BARS), []);
  assert.deepEqual(racingCoins([coin('A', 53_000), coin('B', 12_000), coin('C', 9_000)], NOW, BARS), []);
  assert.deepEqual(racingCoins([coin('A', 53_000)], NOW, BARS), []);
});

test('a coin that only shares the name never races, and does not count as the field either', () => {
  const field = [coin('A', 53_000), coin('B', 22_000), coin('OLD', 20_000, { evidence: ['name_guess', 'existing'] })];
  assert.deepEqual(racingCoins(field, NOW, BARS), ['A', 'B']);
});

test('a crashed coin or one whose creator sold is out; a racer past the window ends the race', () => {
  assert.deepEqual(racingCoins([coin('A', 30_000, {}, 177_000), coin('B', 22_000), coin('C', 12_000)], NOW, BARS), ['B', 'C']);
  const sold = coin('A', 53_000, { trades: { uniqueBuyers: 50, netBuy: 1, capUsd: 53_000, cap: 200, peakCap: 500, creatorSold: true } });
  assert.deepEqual(racingCoins([sold, coin('B', 22_000), coin('C', 12_000)], NOW, BARS), ['B', 'C']);
  assert.deepEqual(racingCoins([coin('A', 53_000, { launchedAtMs: NOW - 31 * MIN }), coin('B', 22_000)], NOW, BARS), []);
});
