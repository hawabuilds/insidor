/**
 * When the token page's chart and trades come from our own data, and when the market source must
 * answer instead. Against a fake database and a fake chainwatch.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Pool } from '@insidor/market-geckoterminal';

import { CANDLES_SQL, CHART_SQL, covers, ownMarket, streamPool, WANT_BARS, type HeldTrades } from './own-market.ts';
import type { Db } from './queries.ts';

const MINT = 'Cg9zDsrNUzkm7cUgrXyv5TaKpbH5dpnr4E7pFAZYpump';
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const MIN = 60_000;
const TRADE = { tx: 's1', side: 'buy' as const, tokenAmount: 10, usd: 1, priceUsd: 0.1, at: NOW - 1000, maker: 'w1' };

function fakeDb(chart: Record<string, unknown> | null, candles: Record<string, unknown>[]): Db & { asked: unknown[][] } {
  const asked: unknown[][] = [];
  return {
    asked,
    query: async (sql: string, params: readonly unknown[] = []) => {
      asked.push([...params]);
      if (sql === CHART_SQL) return chart === null ? [] : [chart];
      if (sql === CANDLES_SQL) return candles;
      throw new Error('unexpected query');
    },
  } as unknown as Db & { asked: unknown[][] };
}

const launchRow = { recorded_from: NOW - 30 * MIN, from_launch: true, pool: 'pump', pool_address: 'curve1', quote_mint: 'So11111111111111111111111111111111111111112', symbol: 'LAURA', name: 'Laura', image_uri: null };
const minutes = [0, 1, 2, 3, 4, 5].map((i) => ({ t: NOW - 30 * MIN + i * MIN, o: 1 + i, h: 2 + i, l: 0.5 + i, c: 1.5 + i }));
const held = (h: HeldTrades) => async () => h;
const noPool = async (): Promise<Pool | null> => null;

test('a recording from launch covers every view; a mid-life one only views it reaches back far enough for', () => {
  assert.equal(covers({ recordedFromMs: NOW - MIN, fromLaunch: true }, '1D', NOW), true);
  assert.equal(covers({ recordedFromMs: NOW - WANT_BARS * MIN, fromLaunch: false }, '1m', NOW), true);
  assert.equal(covers({ recordedFromMs: NOW - WANT_BARS * MIN, fromLaunch: false }, '5m', NOW), false);
});

test('★ a coin we hold from launch is answered from our own rows and chainwatch\'s trades', async () => {
  const db = fakeDb(launchRow, minutes);
  const r = await ownMarket(MINT, '5m', { db, heldTrades: held({ held: true, whole: true, trades: [TRADE] }), pool: noPool, now: () => NOW });
  assert.ok(r !== null);
  assert.deepEqual(r.trades, [TRADE]);
  assert.equal(r.candles.length, 2, 'six minutes, in five-minute candles, aligned to the clock');
  assert.deepEqual(r.candles[0], { t: NOW - 30 * MIN, o: 1, h: 6, l: 0.5, c: 5.5 });
  assert.equal(r.pool?.dex, 'pump-fun', 'named from the stream when the market source has not answered');
  assert.equal(db.asked[1]?.[1], 1, '5m is built from minute rows');
});

test('the hour views read the hourly rows', async () => {
  const db = fakeDb(launchRow, minutes);
  await ownMarket(MINT, '4h', { db, heldTrades: held({ held: true, whole: true, trades: [] }), pool: noPool, now: () => NOW });
  assert.equal(db.asked[1]?.[1], 60);
});

test('the market source\'s pool is used when it answers in time', async () => {
  const pool: Pool = { address: 'P', dex: 'pumpswap', reserveUsd: 5, base: null, quote: null };
  const r = await ownMarket(MINT, '1m', { db: fakeDb(launchRow, minutes), heldTrades: held({ held: true, whole: true, trades: [] }), pool: async () => pool, now: () => NOW });
  assert.equal(r?.pool, pool);
});

test('★ not ours: a coin we never charted, no candles, or chainwatch silent', async () => {
  const deps = { heldTrades: held({ held: true, whole: true, trades: [] }), pool: noPool, now: () => NOW };
  assert.equal(await ownMarket(MINT, '1m', { ...deps, db: fakeDb(null, []) }), null);
  assert.equal(await ownMarket(MINT, '1m', { ...deps, db: fakeDb(launchRow, []) }), null);
  assert.equal(await ownMarket(MINT, '1m', { ...deps, heldTrades: async () => { throw new Error('down'); }, db: fakeDb(launchRow, minutes) }), null);
});

test('★ a coin paired with a token chainwatch does not price (a stock token) is not ours: the market source charts it (364, 2026-11-13)', async () => {
  const msftx = { ...launchRow, pool: 'pump-amm', pool_address: 'pool1', quote_mint: 'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX' };
  const own = await ownMarket('Mint1', '1h', { db: fakeDb(msftx, [{ t: NOW - 6 * 3_600_000, o: 1, h: 1, l: 1, c: 1 }]), heldTrades: async () => ({ held: true, whole: true, trades: [] }), pool: async () => null, now: () => NOW });
  assert.equal(own, null);
  const usdt = { ...launchRow, quote_mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' };
  const ours = await ownMarket('Mint1', '1h', { db: fakeDb(usdt, [{ t: NOW - 6 * 3_600_000, o: 1, h: 1, l: 1, c: 1 }]), heldTrades: async () => ({ held: true, whole: true, trades: [] }), pool: async () => null, now: () => NOW });
  assert.notEqual(ours, null, 'a dollar stablecoin is priced, so ours still answers');
});

test('★ recorded from mid-life for a long view: ours, saying where it starts (2026-10-29)', async () => {
  const r = await ownMarket(MINT, '1h', { db: fakeDb({ ...launchRow, from_launch: false }, minutes), heldTrades: held({ held: true, whole: false, trades: [TRADE] }), pool: noPool, now: () => NOW });
  assert.ok(r !== null);
  assert.ok(r.fromMs !== null);
  assert.equal(r.trades?.length, 1, 'the latest trades we hold');
});

test('a short list from a chainwatch that restarted is not the coin\'s trades: the market source lists them', async () => {
  const r = await ownMarket(MINT, '1m', { db: fakeDb(launchRow, minutes), heldTrades: held({ held: true, whole: false, trades: [TRADE] }), pool: noPool, now: () => NOW });
  assert.ok(r !== null);
  assert.equal(r.trades, null);
  assert.equal(r.candles.length, 6);
});

test('a pool from the stream: its dex by the market source\'s id, the coin\'s own side, liquidity not reported', () => {
  const p = streamPool(MINT, { pool: 'pump-amm', poolAddress: 'Pool1', quoteMint: 'So11111111111111111111111111111111111111112', symbol: 'LAURA', name: 'Laura', imageUrl: 'http://not-https' });
  assert.deepEqual(p, { address: 'Pool1', dex: 'pumpswap', dexName: 'PumpSwap', reserveUsd: null, base: { address: MINT, symbol: 'LAURA', name: 'Laura', imageUrl: null }, quote: { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Wrapped SOL', imageUrl: null } });
  assert.equal(streamPool(MINT, { pool: null, poolAddress: null, quoteMint: null, symbol: null, name: null, imageUrl: null }), null);
});
