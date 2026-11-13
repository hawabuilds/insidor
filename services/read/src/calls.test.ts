/**
 * Insidor's calls (calls.ts): where a call's price starts, how its peak and multiple are read, how
 * the list is ranked and counted, and what the route answers. Against fake rows; no database.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SILENT } from './log.ts';
import { CALLS_SQL, board, createCalls, due, measure, startOf, type Call, type CallRow } from './calls.ts';
import type { Row } from './queries.ts';
import { handle } from './routes.ts';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function call(over: Partial<Call> = {}): Call {
  const foundAt = over.foundAt ?? NOW - DAY;
  return { address: 'Coin1pump', ticker: 'COIN', imageUrl: null, foundAt, mintedAt: foundAt + 30 * MIN, ...over };
}

function row(c: Call, multiple: number | null, over: Partial<CallRow> = {}): CallRow {
  const m = multiple === null ? { v: null, why: 'not_recorded' } : { v: multiple };
  return { ...c, early: c.foundAt < c.mintedAt, startUsd: { v: 5_000 }, peakUsd: multiple === null ? m : { v: 5_000 * multiple }, multiple: m, ...over };
}

test('a post found before its coin starts at the launch price, not the moment we found it', () => {
  const c = call();
  assert.equal(startOf(c), c.mintedAt);
  const r = measure(c, { supply: null, charted: true, start_price: 0.000005, peak_price: 0.02, traded_usd: 9_000_000 });
  assert.equal(r.early, true);
  assert.deepEqual(r.startUsd, { v: 5_000 });
  assert.deepEqual(r.peakUsd, { v: 20_000_000 });
  assert.deepEqual(r.multiple, { v: 4_000 });
});

test('a post found after its coin starts at the price when we found it', () => {
  const c = call({ mintedAt: NOW - DAY - 3 * MIN });
  assert.equal(startOf(c), c.foundAt);
  const r = measure(c, { supply: 1e9, charted: true, start_price: 0.00003, peak_price: 0.0003, traded_usd: 100_000 });
  assert.equal(r.early, false);
  assert.equal(r.multiple.v !== null && Math.round(r.multiple.v), 10);
});

test("the coin's own supply makes a candle price a market cap; a coin off the launchpad without one is not recorded", () => {
  const own = measure(call(), { supply: 2e9, charted: true, start_price: 0.00001, peak_price: 0.0001, traded_usd: 100_000 });
  assert.deepEqual(own.startUsd, { v: 20_000 });
  const off = measure(call({ address: 'Elsewhere111' }), { supply: null, charted: true, start_price: 0.00001, peak_price: 0.0001 });
  assert.deepEqual(off.multiple, { v: null, why: 'not_recorded' });
});

test('no start price is a dash with its reason, never a zero or a guess', () => {
  const r = measure(call(), { supply: 1e9, charted: true, start_price: null, peak_price: 0.001 });
  assert.deepEqual(r.startUsd, { v: null, why: 'not_recorded' });
  assert.deepEqual(r.multiple, { v: null, why: 'not_recorded' });
  assert.deepEqual(measure(call(), undefined).multiple, { v: null, why: 'not_recorded' });
  assert.deepEqual(measure(call(), { supply: 1e9, charted: true, start_price: 0, peak_price: 0.001 }).startUsd, { v: null, why: 'not_recorded' });
});

test('a coin we chart is measured on our candles alone; readings answer only for a coin we do not', () => {
  const charted = measure(call(), { supply: 1e9, charted: true, start_price: null, peak_price: 0.01, start_reading: 4_000, peak_reading: 13_800_000 });
  assert.equal(charted.multiple.v, null);
  const uncharted = measure(call(), { supply: null, charted: null, start_price: null, peak_price: null, start_reading: 4_000, peak_reading: 40_000, reading_traded_usd: 30_000 });
  assert.deepEqual(uncharted.multiple, { v: 10 });
});

test('a peak with little money behind it is thin trading, never a run', () => {
  /* $mihao: a $150M close on about $1M traded. */
  const scam = measure(call(), { supply: 1e9, charted: true, start_price: 0.0000033, peak_price: 0.15, traded_usd: 990_000 });
  assert.deepEqual(scam.multiple, { v: null, why: 'thin_trading' });
  assert.deepEqual(scam.peakUsd, { v: null, why: 'thin_trading' });
  assert.deepEqual(scam.startUsd, { v: 3_300 });
  const unknown = measure(call(), { supply: 1e9, charted: true, start_price: 0.000005, peak_price: 0.0005, traded_usd: null });
  assert.deepEqual(unknown.multiple, { v: null, why: 'thin_trading' });
  const real = measure(call(), { supply: 1e9, charted: true, start_price: 0.000005, peak_price: 0.0005, traded_usd: 75_000 });
  assert.deepEqual(real.multiple, { v: 100 });
});

test('the peak is never under the start: the start is itself a price the coin traded at', () => {
  const r = measure(call(), { supply: 1e9, charted: true, start_price: 0.00005, peak_price: 0.00002 });
  assert.deepEqual(r.multiple, { v: 1 });
});

test('the list is ranked by multiple, unmeasured calls last and newest first, and they still count as calls', () => {
  const rows = [
    row(call({ address: 'a', foundAt: NOW - 2 * DAY }), 3),
    row(call({ address: 'b', foundAt: NOW - 3 * DAY }), null),
    row(call({ address: 'c', foundAt: NOW - DAY }), 250),
    row(call({ address: 'd', foundAt: NOW - DAY / 2 }), null),
    row(call({ address: 'e', foundAt: NOW - 4 * DAY, mintedAt: NOW - 5 * DAY }), 12),
  ];
  const b = board(rows, 'week', NOW);
  assert.deepEqual(b.rows.map((r) => r.address), ['c', 'e', 'a', 'd', 'b']);
  assert.equal(b.record.calls, 5);
  assert.equal(b.record.tenX, 2);
  assert.deepEqual(b.record.best, { v: 250 });
  assert.deepEqual(b.record.earlyShare, { v: 4 / 5 });
});

test('a window keeps the calls found inside it; an empty one says so instead of a zero best', () => {
  const rows = [row(call({ address: 'old', foundAt: NOW - 20 * DAY }), 50), row(call({ address: 'new', foundAt: NOW - DAY }), 2)];
  assert.deepEqual(board(rows, 'week', NOW).rows.map((r) => r.address), ['new']);
  assert.equal(board(rows, 'month', NOW).rows.length, 2);
  assert.equal(board(rows, 'all', NOW).rows.length, 2);
  const empty = board([], 'week', NOW);
  assert.equal(empty.record.calls, 0);
  assert.deepEqual(empty.record.best, { v: null, why: 'no_calls' });
  assert.deepEqual(empty.record.earlyShare, { v: null, why: 'no_calls' });
});

test('a recent call is read again within minutes; an old one a few times a day', () => {
  const recent = call({ foundAt: NOW - DAY });
  const old = call({ foundAt: NOW - 10 * DAY });
  assert.equal(due(recent, undefined, NOW), true);
  assert.equal(due(recent, NOW - 5 * MIN, NOW), false);
  assert.equal(due(recent, NOW - 11 * MIN, NOW), true);
  assert.equal(due(old, NOW - 60 * MIN, NOW), false);
  assert.equal(due(old, NOW - 7 * 60 * MIN, NOW), true);
});

function fakeDb(listed: readonly Row[], prices: Row) {
  const asked: string[] = [];
  return {
    asked,
    db: {
      async query(sql: string): Promise<readonly Row[]> {
        asked.push(sql === CALLS_SQL ? 'list' : 'prices');
        return sql === CALLS_SQL ? listed : [prices];
      },
    },
  };
}

test('the first ask is answered "counting"; after a pass the board is served from memory', async () => {
  const listed = [{ address: 'Coin1pump', found: NOW - DAY, minted: NOW - DAY + MIN, ticker: 'COIN', image_url: 'http://not-https' }];
  const { db, asked } = fakeDb(listed, { supply: 1e9, charted: true, start_price: 0.000005, peak_price: 0.00005, traded_usd: 40_000 });
  const calls = createCalls({ db, log: SILENT, now: () => NOW, origins: ['live_stream'] });
  assert.deepEqual(calls.read('week'), { state: 'counting' });
  await calls.passNow();
  const b = calls.read('week');
  assert.equal(b.state, 'ready');
  if (b.state !== 'ready') return;
  assert.equal(b.rows[0]?.imageUrl, null, 'a picture not on https is left out');
  assert.deepEqual(b.rows[0]?.multiple, { v: 10 });
  const before = asked.length;
  await calls.passNow();
  assert.equal(asked.length, before + 1, 'a call read minutes ago is not read again');
});

test('the route answers a window, and a 404 for anything else', async () => {
  const { db } = fakeDb([], {});
  const calls = createCalls({ db, log: SILENT, now: () => NOW, origins: ['live_stream'] });
  await calls.passNow();
  const ok = await handle('GET', '/calls/month', { db, log: SILENT, calls }, '');
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).state, 'ready');
  assert.equal((await handle('GET', '/calls/year', { db, log: SILENT, calls }, '')).status, 404);
});
