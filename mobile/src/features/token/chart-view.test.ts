/**
 * The token chart's views: All fits a coin's whole life at the candle size its age needs, 1s is
 * built from trades alone, a young coin opens on All, and the source is only ever asked for a
 * timeframe it serves.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { MarketTrade } from '../../shared/api/index.ts';
import { allTimeframe, defaultView, fetchTimeframe, periodMs, tradesToCandles } from './chart-view.ts';

const H = 3_600_000;

test('★ All picks the candle size for the coin\'s age', () => {
  assert.equal(allTimeframe(20 * 60_000), '1m');
  assert.equal(allTimeframe(6 * H), '5m');
  assert.equal(allTimeframe(20 * H), '15m');
  assert.equal(allTimeframe(3 * 24 * H), '1h');
  assert.equal(allTimeframe(10 * 24 * H), '4h');
  assert.equal(allTimeframe(60 * 24 * H), '1D');
  assert.equal(allTimeframe(null), '1h');
});

test('the source is asked only for a timeframe it serves; 1s is a second long', () => {
  assert.equal(fetchTimeframe('1s', 60_000), '1m');
  assert.equal(fetchTimeframe('all', 20 * 60_000), '1m');
  assert.equal(fetchTimeframe('5m', null), '5m');
  assert.equal(periodMs('1s', null), 1_000);
  assert.equal(periodMs('all', 6 * H), 5 * 60_000);
});

test('★ a coin on its curve or under a day old opens on All; an older one on 1h', () => {
  assert.equal(defaultView({ onCurve: true, launchedAt: null, now: 0 }), 'all');
  assert.equal(defaultView({ onCurve: false, launchedAt: 0, now: 3 * H }), 'all');
  assert.equal(defaultView({ onCurve: false, launchedAt: 0, now: 30 * H }), '1h');
});

test('1s candles are built from trades alone, a bad print left out', () => {
  const trade = (at: number, price: number): MarketTrade => ({ tx: `${at}`, side: 'buy', tokenAmount: { known: true, amount: 1 }, usd: { known: true, amount: price }, priceUsd: { known: true, amount: price }, at: { known: true, at }, maker: 'w' }) as unknown as MarketTrade;
  const c = tradesToCandles([trade(1_200, 2), trade(1_900, 3), trade(2_100, 2.5), trade(2_500, 900)], 1_000);
  assert.deepEqual(c.map((x) => [x.t, x.open, x.high, x.low, x.price]), [[1_000, 2, 3, 2, 3], [2_000, 3, 3, 2.5, 2.5]]);
});
