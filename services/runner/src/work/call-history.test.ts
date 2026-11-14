/**
 * The calls' price history step (call-history.ts): which side of a pool is the coin, which hours are
 * kept, and what a read writes — hours and a 'read' row, a 'no_pool' row, or a 'failed' row that is
 * never mistaken for a coin with no history. Against a fake market and database.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { FullCandle, Pool } from '@insidor/market-geckoterminal';

import { DUE_SQL, UPSERT_HOURS_SQL, UPSERT_READ_SQL, cleanHours, readCallHistory, readOne, tickerIn } from './call-history.ts';

const MINT = 'Coin1111111111111111111111111111111111pump';
const SOL = 'So11111111111111111111111111111111111111112';
const pool = (base: string, symbol: string | null): Pool => ({
  address: 'Pool1',
  dex: 'pumpswap',
  reserveUsd: 1,
  base: { address: base, symbol, name: null, imageUrl: null },
  quote: { address: base === MINT ? SOL : MINT, symbol: base === MINT ? 'SOL' : '$FTR', name: null, imageUrl: null },
});
const hour = (t: number, h: number, over: Partial<FullCandle> = {}): FullCandle => ({ t, o: 1, h, l: 1, c: 1, v: 100, ...over });
const silent = { info: () => undefined, warn: () => undefined };

function fakeDb(due: readonly Record<string, unknown>[] = []) {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  return {
    calls,
    db: {
      async query(sql: string, params: readonly unknown[] = []) {
        calls.push({ sql, params });
        return sql === DUE_SQL ? due : [];
      },
    },
  };
}

test("the coin's ticker is whichever side of the pool is the coin, without its dollar sign", () => {
  assert.equal(tickerIn(pool(MINT, 'FTR'), MINT), 'FTR');
  assert.equal(tickerIn(pool(SOL, 'SOL'), MINT), 'FTR');
  assert.equal(tickerIn(pool(MINT, '  '), MINT), null);
  assert.equal(tickerIn(null, MINT), null);
});

test('an hour with a missing or impossible price is not kept', () => {
  const kept = cleanHours([hour(1, 2), hour(2, 0.5), { ...hour(3, 2), c: 0 }, hour(4, Number.POSITIVE_INFINITY)]);
  assert.deepEqual(kept.map((k) => k.t), [1]);
});

test('a read writes its hours, then a read row with the pool and ticker', async () => {
  const { db, calls } = fakeDb();
  const r = await readOne({ db, log: silent, now: () => 1_000, market: { hourly: async () => ({ pool: pool(MINT, 'FTR'), candles: [hour(3_600_000, 2), hour(7_200_000, 3)] }) } }, MINT);
  assert.equal(r, 'read');
  assert.equal(calls[0]?.sql, UPSERT_HOURS_SQL);
  assert.deepEqual(calls[0]?.params.slice(0, 3), [MINT, [3_600_000, 7_200_000], [1, 1]]);
  assert.equal(calls[1]?.sql, UPSERT_READ_SQL);
  assert.deepEqual(calls[1]?.params, [MINT, 1_000, 'read', 'Pool1', 'FTR']);
});

test('no pool is written as no_pool, a refusal as failed — never as a coin with no history', async () => {
  const none = fakeDb();
  assert.equal(await readOne({ db: none.db, log: silent, now: () => 1, market: { hourly: async () => ({ pool: null, candles: [] }) } }, MINT), 'no_pool');
  assert.deepEqual(none.calls.map((c) => c.params[2]), ['no_pool']);
  const refused = fakeDb();
  assert.equal(await readOne({ db: refused.db, log: silent, now: () => 1, market: { hourly: async () => { throw new Error('429'); } } }, MINT), 'failed');
  assert.deepEqual(refused.calls.map((c) => c.sql), [UPSERT_READ_SQL]);
  assert.equal(refused.calls[0]?.params[2], 'failed');
  const empty = fakeDb();
  assert.equal(await readOne({ db: empty.db, log: silent, now: () => 1, market: { hourly: async () => ({ pool: pool(MINT, 'X'), candles: [] }) } }, MINT), 'failed');
});

test('a pass reads the calls owed, at most perPass, and asks for failed reads again only after the retry wait', async () => {
  const { db, calls } = fakeDb([{ address: MINT }, { address: 'Other1pump' }]);
  const asked: string[] = [];
  const tally = await readCallHistory({ db, log: silent, now: () => 5, perPass: 2, market: { hourly: async (m) => { asked.push(m); return { pool: pool(m, 'A'), candles: [hour(1, 2)] }; } } });
  assert.deepEqual(asked, [MINT, 'Other1pump']);
  assert.deepEqual(tally, { read: 2, failed: 0, noPool: 0 });
  assert.equal(calls[0]?.params[6], 2, 'the limit');
  assert.equal(calls[0]?.params[1], 3_600_000, 'failed reads wait an hour by default');
  const now = fakeDb([]);
  await readCallHistory({ db: now.db, log: silent, now: () => 5, retryMs: 0, market: { hourly: async () => ({ pool: null, candles: [] }) } });
  assert.equal(now.calls[0]?.params[1], 0, 'the backfill retries at once');
});
