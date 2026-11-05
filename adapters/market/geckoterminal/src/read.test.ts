/**
 * The replies, read: the pool a coin trades in, candles oldest first, a six-hour view merged
 * from hourly candles, and each trade's side and price read from OUR coin's side of it.
 * Recorded replies only (see __fixtures__); no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CURVE_MINT, OHLCV_5M, POOLS, TRADES } from './__fixtures__/replies.ts';
import { LAURA_MINT, MSTRX_MINT, PAIRED_POOLS } from './__fixtures__/paired-pools.ts';
import { aggregate, ownSide, pairedWith, primaryPool, readCandles, readPools, readTrades, readVolumeCandles } from './read.ts';

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

test('★ a pool names both its tokens and its dex: Laura trades against MSTRx on PumpSwap', () => {
  const pools = readPools(PAIRED_POOLS);
  const main = primaryPool(pools);
  assert.equal(main?.dex, 'pumpswap');
  assert.equal(main?.dexName, 'PumpSwap');
  assert.equal(main?.reserveUsd, 17471.8487);
  const other = main === null ? null : pairedWith(main, LAURA_MINT);
  assert.equal(other?.address, MSTRX_MINT);
  assert.equal(other?.symbol, 'MSTRx');
  assert.equal(other?.name, 'MicroStrategy xStock');
  assert.ok(other?.imageUrl?.startsWith('https://'));
  assert.equal(main === null ? null : ownSide(main, LAURA_MINT)?.symbol, 'Laura');
});

test('a coin on the quote side is paired with the base; a pool without it pairs it with nothing', () => {
  const curve = readPools(PAIRED_POOLS).find((p) => p.dex === 'pump-fun');
  assert.ok(curve !== undefined);
  assert.equal(pairedWith(curve, LAURA_MINT)?.symbol, 'LAURACAT');
  assert.equal(pairedWith(curve, 'SomeOtherMint'), null);
});

test('a reply without included tokens leaves both sides unknown, never guessed from the pool name', () => {
  const pools = readPools(POOLS);
  assert.ok(pools.every((p) => p.base === null && p.quote === null && p.dexName === null));
});

test('★ a stray thin pool does not beat the curve the coin trades on; its own graduation pool always does ($GIF, 2026-11-05)', () => {
  const GIF = 'E86A12o3L9CBZCoJ3uYsT87WPEaMHy9dZVzgfdHXpump';
  const tok = (address: string) => ({ address, symbol: null, name: null, imageUrl: null });
  const curve = { address: 'curve', dex: 'pump-fun', reserveUsd: 0, volume24hUsd: 87_307, base: tok(GIF), quote: tok('OPENAI') };
  const hadron = { address: 'hadron', dex: 'hadron', reserveUsd: 255.6, volume24hUsd: 182, base: tok(GIF), quote: tok('SOL') };
  const meteora = { address: 'meteora', dex: 'meteora-damm-v2', reserveUsd: 7.7, volume24hUsd: 23, base: tok(GIF), quote: tok('SOL') };
  assert.equal(primaryPool([hadron, meteora, curve])?.address, 'curve');
  assert.equal(primaryPool([{ ...hadron, reserveUsd: 40_000 }, curve])?.address, 'hadron', 'a real pool still wins');
  assert.equal(primaryPool([{ ...hadron, volume24hUsd: 90_000 }, curve])?.address, 'hadron', 'the thin pool trades more: it is the market');
  assert.equal(primaryPool([hadron, { ...curve, volume24hUsd: null }])?.address, 'hadron', 'curve trading unknown: as before');
  const ownPool = { address: 'pumpswap', dex: 'pumpswap', reserveUsd: 900, volume24hUsd: 50, base: tok(GIF), quote: tok('OPENAI') };
  assert.equal(primaryPool([ownPool, curve])?.address, 'pumpswap', 'graduated today and fell: still its own pool');
});
