/**
 * The running coins strip (running-coins.ts): which coins are on it, in what order, and what the
 * route answers. Against a fake query function; no database.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from '@insidor/contracts';

import { SILENT } from './log.ts';
import { RUNNING_COINS_SQL, createRunningCoins, dollarsGained, runningCoins } from './running-coins.ts';
import type { Row } from './queries.ts';
import { handle } from './routes.ts';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

function row(address: string, cap: number | null, pct: number | null, over: { at?: number; venue?: string; origin?: string | null; tradable?: boolean; ticker?: string } = {}): Row {
  return {
    coin: {
      coinId: `solana:${address}`,
      address,
      ticker: over.ticker ?? address.toUpperCase(),
      imageUrl: null,
      tradable: over.tradable ?? true,
      marketCapUsd: cap === null ? { v: null, why: 'no_market' } : { v: cap },
      priceChange24h: pct === null ? { v: null, why: 'no_market' } : { v: pct },
    },
    at_ms: String(over.at ?? NOW - MIN),
    venue_id: over.venue ?? 'solana:pumpfun',
    origin: over.origin === undefined ? 'live_stream' : over.origin,
  };
}

test('dollars gained is the cap less the cap a day ago', () => {
  assert.equal(dollarsGained(200, 100), 100);
  assert.equal(dollarsGained(50, -50), -50);
  assert.equal(dollarsGained(100, -100), null);
});

test('ordered by dollars gained, not by percent', () => {
  const { coins } = runningCoins([row('small', 3_000, 300), row('big', 2_000_000, 30), row('down', 10_000_000, -30)], NOW);
  assert.deepEqual(coins.map((c) => c.address), ['big', 'small', 'down']);
  assert.deepEqual(coins[0], { coinId: 'solana:big', address: 'big', ticker: 'BIG', imageUrl: null, marketCapUsd: 2_000_000, change24hPct: 30 });
});

test('a coin with no price, no move, or not tradable is left out, never shown as 0', () => {
  const { coins } = runningCoins([row('nocap', null, 10), row('nomove', 5_000, null), row('zero', 0, 10), row('locked', 9_000, 10, { tradable: false }), row('ok', 9_000, 10)], NOW);
  assert.deepEqual(coins.map((c) => c.address), ['ok']);
});

test('only launchpad coins seen launching', () => {
  const { coins } = runningCoins([row('pool', 9_000, 10, { venue: 'solana:raydium' }), row('guess', 9_000, 10, { origin: 'seed' }), row('none', 9_000, 10, { origin: null }), row('ok', 9_000, 10, { origin: 'backfill' })], NOW);
  assert.deepEqual(coins.map((c) => c.address), ['ok']);
});

test('a price from a stalled frame is left out', () => {
  const fresh = DEFAULT_POLICY.runningCoins.freshMs;
  const { coins } = runningCoins([row('old', 9_000, 10, { at: NOW - fresh - 1 }), row('edge', 9_000, 10, { at: NOW - fresh })], NOW);
  assert.deepEqual(coins.map((c) => c.address), ['edge']);
});

test('one coin once, with the fresher frame\'s numbers', () => {
  const { coins } = runningCoins([row('a', 9_000, 10, { at: NOW - 3 * MIN }), row('a', 12_000, 20, { at: NOW - MIN }), row('a', 1_000, 1, { at: NOW - 2 * MIN })], NOW);
  assert.equal(coins.length, 1);
  assert.equal(coins[0]?.marketCapUsd, 12_000);
});

test('at most maxCoins', () => {
  const rows = Array.from({ length: 30 }, (_, i) => row(`c${String(i).padStart(2, '0')}`, 10_000 + i, 10));
  const { coins } = runningCoins(rows, NOW);
  assert.equal(coins.length, DEFAULT_POLICY.runningCoins.maxCoins);
  assert.equal(coins[0]?.address, 'c29');
});

test('the route answers the list, read once per keepMs', async () => {
  let reads = 0;
  let t = NOW;
  const db = {
    async query(sql: string): Promise<readonly Row[]> {
      if (sql !== RUNNING_COINS_SQL) throw new Error('unexpected statement');
      reads += 1;
      return [row('a', 9_000, 10)];
    },
  };
  const runningCoins = createRunningCoins(() => t);
  const deps = { db, log: SILENT, runningCoins };
  const first = await handle('GET', '/running/coins', deps);
  assert.equal(first.status, 200);
  assert.deepEqual(JSON.parse(first.body).coins.map((c: { address: string }) => c.address), ['a']);
  await handle('GET', '/running/coins', deps);
  assert.equal(reads, 1);
  t += DEFAULT_POLICY.runningCoins.keepMs;
  await handle('GET', '/running/coins', deps);
  assert.equal(reads, 2);
});

test('an empty strip is an empty list', async () => {
  const db = { async query(): Promise<readonly Row[]> { return []; } };
  const reply = await handle('GET', '/running/coins', { db, log: SILENT });
  assert.deepEqual(JSON.parse(reply.body), { coins: [] });
});
