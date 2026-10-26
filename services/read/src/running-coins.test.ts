/**
 * The running coins strip (running-coins.ts): which coins are on it, in what order, and what the
 * route answers. Against a fake query function; no database.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from '@insidor/contracts';

import { SILENT } from './log.ts';
import { RUNNING_COINS_SQL, createRunningCoins, runningCoins } from './running-coins.ts';
import type { Row } from './queries.ts';
import { handle } from './routes.ts';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const RULE = DEFAULT_POLICY.runningCoins;
/** An hour comfortably over both floors, unless a test says otherwise. */
const BUSY = { volume: RULE.minVolume1hUsd * 5, trades: RULE.minTrades1h * 5 };

type Over = { at?: number; venue?: string; origin?: string | null; tradable?: boolean; ticker?: string; volume?: number | null; trades?: number | null };

function row(address: string, cap: number | null, pct: number | null, over: Over = {}): Row {
  const volume = over.volume === undefined ? BUSY.volume : over.volume;
  const trades = over.trades === undefined ? BUSY.trades : over.trades;
  return {
    coin: {
      coinId: `solana:${address}`,
      address,
      ticker: over.ticker ?? address.toUpperCase(),
      imageUrl: null,
      tradable: over.tradable ?? true,
      marketCapUsd: cap === null ? { v: null, why: 'no_market' } : { v: cap },
      priceChange24h: pct === null ? { v: null, why: 'no_market' } : { v: pct },
      volume1hUsd: volume === null ? { v: null, why: 'not_read_yet' } : { v: volume },
      trades1h: trades === null ? { v: null, why: 'not_read_yet' } : { v: trades },
    },
    at_ms: String(over.at ?? NOW - MIN),
    venue_id: over.venue ?? 'solana:pumpfun',
    origin: over.origin === undefined ? 'live_stream' : over.origin,
  };
}

test('ordered by the last hour\'s dollars traded, not by the day\'s move or the cap', () => {
  const { coins } = runningCoins([
    row('yesterday', 2_000_000, 5_000, { volume: 1_500 }),
    row('busy', 30_000, -20, { volume: 90_000 }),
    row('big', 10_000_000, 30, { volume: 40_000 }),
  ], NOW);
  assert.deepEqual(coins.map((c) => c.address), ['busy', 'big', 'yesterday']);
  assert.deepEqual(coins[0], { coinId: 'solana:busy', address: 'busy', ticker: 'BUSY', imageUrl: null, marketCapUsd: 30_000, change24hPct: -20, volume1hUsd: 90_000, trades1h: BUSY.trades });
});

test('★ a coin that stopped trading is left out, however far it ran in the day', () => {
  const { coins } = runningCoins([
    row('dead', 40_000, 1_129, { volume: 0, trades: 0 }),
    row('thin', 40_000, 600, { volume: RULE.minVolume1hUsd - 1 }),
    row('few', 40_000, 600, { volume: 50_000, trades: RULE.minTrades1h - 1 }),
    row('edge', 40_000, 10, { volume: RULE.minVolume1hUsd, trades: RULE.minTrades1h }),
  ], NOW);
  assert.deepEqual(coins.map((c) => c.address), ['edge']);
});

test('★ an hour the card did not carry is not a quiet hour, and not a busy one: the coin is left out', () => {
  const { coins } = runningCoins([row('unread', 40_000, 10, { volume: null, trades: null }), row('half', 40_000, 10, { trades: null }), row('ok', 40_000, 10)], NOW);
  assert.deepEqual(coins.map((c) => c.address), ['ok']);
});

test('the fresher frame\'s hour decides, even when an older frame\'s was busier', () => {
  const { coins } = runningCoins([row('a', 29_000, 10, { at: NOW - 3 * MIN, volume: 80_000 }), row('a', 29_000, 10, { at: NOW - MIN, volume: 0, trades: 0 })], NOW);
  assert.deepEqual(coins, []);
});

test('a coin with no price, no move, or not tradable is left out, never shown as 0', () => {
  const { coins } = runningCoins([row('nocap', null, 10), row('nomove', 25_000, null), row('zero', 0, 10), row('locked', 29_000, 10, { tradable: false }), row('ok', 29_000, 10)], NOW);
  assert.deepEqual(coins.map((c) => c.address), ['ok']);
});

test('only launchpad coins seen launching', () => {
  const { coins } = runningCoins([row('pool', 29_000, 10, { venue: 'solana:raydium' }), row('guess', 29_000, 10, { origin: 'seed' }), row('none', 29_000, 10, { origin: null }), row('ok', 29_000, 10, { origin: 'backfill' })], NOW);
  assert.deepEqual(coins.map((c) => c.address), ['ok']);
});

test('a price from a stalled frame is left out', () => {
  const fresh = DEFAULT_POLICY.runningCoins.freshMs;
  const { coins } = runningCoins([row('old', 29_000, 10, { at: NOW - fresh - 1 }), row('edge', 29_000, 10, { at: NOW - fresh })], NOW);
  assert.deepEqual(coins.map((c) => c.address), ['edge']);
});

test('one coin once, with the fresher frame\'s numbers', () => {
  const { coins } = runningCoins([row('a', 29_000, 10, { at: NOW - 3 * MIN }), row('a', 32_000, 20, { at: NOW - MIN }), row('a', 21_000, 1, { at: NOW - 2 * MIN })], NOW);
  assert.equal(coins.length, 1);
  assert.equal(coins[0]?.marketCapUsd, 32_000);
});

test('at most maxCoins', () => {
  const rows = Array.from({ length: 30 }, (_, i) => row(`c${String(i).padStart(2, '0')}`, 30_000, 10, { volume: BUSY.volume + i }));
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
      return [row('a', 29_000, 10)];
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

test('★ a coin under the cap floor is not on the tape, however busy its hour (the owner, 2026-10-26)', () => {
  const floor = DEFAULT_POLICY.runningCoins.minCapUsd;
  const { coins } = runningCoins([row('copy', floor - 1, 10, { volume: BUSY.volume * 10 }), row('runner', floor, 10)], NOW);
  assert.deepEqual(coins.map((c) => c.address), ['runner']);
});

test('★ viral-post coins trending over the day: ordered by the day\'s dollars, a quiet day left out (the owner, 2026-10-26)', () => {
  const dayRow = (address: string, cap: number, day: number | null): Row => {
    const r = row(address, cap, 10);
    return { ...r, coin: { ...(r['coin'] as Record<string, unknown>), volume24hUsd: day === null ? { v: null } : { v: day } } };
  };
  const floor = DEFAULT_POLICY.runningCoins.minVolume24hUsd;
  const { coins } = runningCoins([dayRow('small-day', 50_000, floor * 2), dayRow('big-day', 40_000, floor * 50), dayRow('quiet', 900_000, floor - 1)], NOW);
  assert.deepEqual(coins.map((c) => c.address), ['big-day', 'small-day']);
});
