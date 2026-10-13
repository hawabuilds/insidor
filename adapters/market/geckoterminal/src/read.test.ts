/**
 * The replies, read: the pool a coin trades in, candles oldest first, a six-hour view merged
 * from hourly candles, and each trade's side and price read from OUR coin's side of it.
 * Recorded replies only (see __fixtures__); no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CURVE_MINT, OHLCV_5M, POOLS, TRADES } from './__fixtures__/replies.ts';
import { aggregate, primaryPool, readCandles, readPools, readTrades, readVolumeCandles } from './read.ts';

test('★ a graduated coin trades in its deepest listed pool, not its old curve', () => {
  const pools = readPools(POOLS);
  assert.deepEqual(pools.map((p) => p.dex), ['pump-fun', 'pumpswap', 'meteora']);
  assert.equal(primaryPool(pools)?.dex, 'pumpswap');
  assert.equal(primaryPool(pools.filter((p) => p.dex === 'pump-fun'))?.dex, 'pump-fun', 'a coin with only its curve trades on the curve');
  assert.equal(primaryPool([]), null);
});

test('candles come back oldest first, in milliseconds', () => {
  const candles = readCandles(OHLCV_5M);
  assert.equal(candles.length, 5);
  for (let i = 1; i < candles.length; i++) assert.ok((candles[i]?.t ?? 0) > (candles[i - 1]?.t ?? 0));
  assert.ok((candles[0]?.t ?? 0) > 1_700_000_000_000);
});

test('the six-hour view merges candles: first open, highest high, lowest low, last close', () => {
  const H = 3_600_000;
  const merged = aggregate([
    { t: 0, o: 1, h: 2, l: 0.5, c: 1.5 },
    { t: H, o: 1.5, h: 3, l: 1, c: 2 },
    { t: 6 * H, o: 2, h: 2, l: 2, c: 2 },
  ], 6 * H);
  assert.deepEqual(merged, [{ t: 0, o: 1, h: 3, l: 0.5, c: 2 }, { t: 6 * H, o: 2, h: 2, l: 2, c: 2 }]);
});

test('★ a trade\'s side and price are read from our coin\'s side of it', () => {
  const trades = readTrades(TRADES, CURVE_MINT);
  assert.equal(trades.length, 4);
  for (const t of trades) {
    assert.ok(t.side === 'buy' || t.side === 'sell');
    assert.ok(t.priceUsd !== null && t.priceUsd < 1, 'the coin\'s price, never SOL\'s');
    assert.ok(t.at !== null && t.tx.length > 40);
  }
  assert.deepEqual(readTrades(TRADES, 'SomeOtherMint'), [], 'a trade not in our coin is not ours');
});

test('candles with volume keep the dollar volume, oldest first; a row without it is unread, not zero', () => {
  const candles = readVolumeCandles(OHLCV_5M);
  assert.equal(candles.length, 5);
  assert.ok(candles.every((c) => c.v !== null && c.v >= 0));
  for (let i = 1; i < candles.length; i++) assert.ok((candles[i]?.t ?? 0) > (candles[i - 1]?.t ?? 0));
  const short = readVolumeCandles({ data: { attributes: { ohlcv_list: [[1_791_709_500, 1, 1, 1, 0.5]] } } });
  assert.deepEqual(short, [{ t: 1_791_709_500_000, c: 0.5, v: null }]);
});
