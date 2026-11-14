/**
 * Insidor's calls (calls.ts): a call's start is the market cap we told people, how its peak and
 * multiple are read, how the list is ranked and counted, and what the route answers. Against fake
 * rows; no database.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SILENT } from './log.ts';
import { CALLS_SQL, CALL_PRICES_SQL, board, callsFrom, createCalls, due, measure, type Call, type CallRow } from './calls.ts';
import type { Row } from './queries.ts';
import { handle } from './routes.ts';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function call(over: Partial<Call> = {}): Call {
  const notifiedAt = over.notifiedAt ?? NOW - DAY;
  return { address: 'Coin1pump', ticker: 'COIN', imageUrl: null, notifiedAt, moved: false, foundAt: notifiedAt - 40 * MIN, notifiedCapUsd: 10_000, mintedAt: notifiedAt - 3 * MIN, ...over };
}

function row(c: Call, multiple: number | null): CallRow {
  const m = multiple === null ? { v: null, why: 'not_recorded' } : { v: multiple };
  return { ...c, startUsd: { v: 10_000 }, peakUsd: multiple === null ? m : { v: 10_000 * multiple }, multiple: m };
}

/** A price row with the coin's own pool history only (prices per coin; supply 1e9 → $1 a coin is $1B). */
const hist = (over: Row = {}): Row => ({ supply: 1e9, hist_peak: 0.0025, hist_traded: 900_000, hist_hour_high: 0.000012, hist_hour_close: 0.000011, charted: false, ...over });

test('a call starts at the market cap we told people, and runs to the peak in its own pool since', () => {
  const r = measure(call({ notifiedCapUsd: 12_500 }), hist());
  assert.deepEqual(r.startUsd, { v: 12_500 });
  assert.deepEqual(r.peakUsd, { v: 2_500_000 });
  assert.deepEqual(r.multiple, { v: 200 });
});

test("the peak is the higher of the pool's history and our own candles", () => {
  /* $Kim: our candles began after the run; the pool's history has it. */
  const kim = measure(call({ notifiedCapUsd: 571_000 }), hist({ hist_peak: 0.0156, hist_traded: 9e6, hist_hour_high: 0.0006, own_peak: 0.000588, charted: true }));
  assert.equal(Math.round(kim.multiple.v ?? 0), 27);
  const ours = measure(call(), hist({ hist_peak: 0.00004, own_peak: 0.0001, own_traded: 100_000, charted: true }));
  assert.deepEqual(ours.peakUsd, { v: 100_000 });
  const notOurs = measure(call(), hist({ hist_peak: 0.00004, own_peak: 0.0001, charted: false }));
  assert.deepEqual(notOurs.peakUsd, { v: 40_000 }, 'our candles count only when they cover the call');
});

test("a told cap far above its hour on the chart is not a price the coin traded at: the hour's high starts it", () => {
  /* $CHUNGUS: the card read $42K in an hour its pool traded no higher than $15K, and closed near $2K. */
  const chungus = measure(call({ notifiedCapUsd: 42_074 }), hist({ hist_peak: 0.000128, hist_traded: 2e6, hist_hour_high: 0.000015, hist_hour_close: 0.000002 }));
  assert.deepEqual(chungus.startUsd, { v: 15_000 }, 'the high, the most anyone could have paid — never the dumped close');
  assert.equal(Math.round(chungus.multiple.v ?? 0), 9);
  const fair = measure(call({ notifiedCapUsd: 70_000 }), hist({ hist_hour_high: 0.00004 }));
  assert.deepEqual(fair.startUsd, { v: 70_000 }, 'within twice the hour high, the told cap stands');
});

test('an old call moved to its For You moment is priced by the first reading after it', () => {
  /* $FTR: on For You a minute after launch at $12.5K; its first alert five hours later at $465K. */
  const ftr = measure(call({ moved: true, notifiedCapUsd: null }), hist({ start_reading: 12_505, hist_peak: 0.0065, hist_traded: 30e6, hist_hour_high: 0.00006 }));
  assert.deepEqual(ftr.startUsd, { v: 12_505 });
  assert.equal(Math.round(ftr.multiple.v ?? 0), 520);
  const noReading = measure(call({ moved: true, notifiedCapUsd: null }), hist({ start_reading: null }));
  assert.deepEqual(noReading.startUsd, { v: 12_000 }, "no reading: the hour's high");
});

test('no told cap and no chart for its hour is a dash with its reason, never a guess', () => {
  const r = measure(call({ notifiedCapUsd: null }), hist({ hist_hour_high: null, hist_hour_close: null }));
  assert.deepEqual(r.startUsd, { v: null, why: 'not_recorded' });
  assert.deepEqual(r.multiple, { v: null, why: 'not_recorded' });
  assert.deepEqual(measure(call(), undefined).multiple, { v: null, why: 'not_recorded' });
});

test("the coin's own supply makes a price a market cap; a coin off the launchpad without one is not recorded", () => {
  const own = measure(call(), hist({ supply: 2e9, hist_peak: 0.0001, hist_traded: 100_000 }));
  assert.deepEqual(own.peakUsd, { v: 200_000 });
  const off = measure(call({ address: 'Elsewhere111' }), hist({ supply: null, hist_peak: 0.0001 }));
  assert.deepEqual(off.multiple, { v: null, why: 'not_recorded' });
});

test('readings answer only for a coin no history covers', () => {
  const covered = measure(call(), hist({ hist_peak: 0.00002, hist_traded: 1e6, peak_reading: 13_800_000, reading_traded_usd: 9e9 }));
  assert.deepEqual(covered.peakUsd, { v: 20_000 });
  const uncovered = measure(call(), { supply: null, charted: false, hist_peak: null, peak_reading: 100_000, reading_traded_usd: 30_000 });
  assert.deepEqual(uncovered.multiple, { v: 10 });
});

test('a peak with little money behind it is thin trading, never a run', () => {
  /* $mihao: a $150M top on about $1M traded. */
  const scam = measure(call(), hist({ hist_peak: 0.15, hist_traded: 990_000 }));
  assert.deepEqual(scam.multiple, { v: null, why: 'thin_trading' });
  assert.deepEqual(scam.peakUsd, { v: null, why: 'thin_trading' });
  assert.deepEqual(scam.startUsd, { v: 10_000 });
  assert.deepEqual(measure(call(), hist({ hist_peak: 0.001, hist_traded: null })).multiple, { v: null, why: 'thin_trading' });
  assert.deepEqual(measure(call(), hist({ hist_peak: 0.001, hist_traded: 150_000 })).multiple, { v: 100 });
});

test('the peak is never under the start: the start was a price the coin traded at', () => {
  assert.deepEqual(measure(call(), hist({ hist_peak: 0.000002, hist_traded: 10 })).multiple, { v: 1 });
});

test('the spike guard is in the price query: an hour counts at its high only when it traded enough of it', () => {
  assert.match(CALL_PRICES_SQL, /when k\.volume_usd >= \$4::double precision \* k\.h \* sup\.supply then k\.h else k\.c end/);
});

test('a row the database sends without a notified moment is not a call', () => {
  const calls = callsFrom([
    { address: 'A1pump', notified: NOW, notified_cap: 9_000, minted: NOW - MIN, ticker: 'A', image_url: 'https://x/a.png' },
    { address: 'B1pump', notified: null, notified_cap: 9_000, minted: NOW, ticker: 'B', image_url: null },
    { address: 'C1pump', notified: NOW, notified_cap: 0, minted: NOW, ticker: 'C', image_url: 'http://not-https' },
  ]);
  assert.deepEqual(calls.map((c) => c.address), ['A1pump', 'C1pump']);
  assert.equal(calls[1]?.notifiedCapUsd, null, 'a zero cap is not a cap');
  assert.equal(calls[1]?.imageUrl, null, 'a picture not on https is left out');
});

test('the list is ranked by multiple, unmeasured calls last and newest first, and they still count as calls', () => {
  const rows = [
    row(call({ address: 'a', notifiedAt: NOW - 2 * DAY }), 3),
    row(call({ address: 'b', notifiedAt: NOW - 3 * DAY }), null),
    row(call({ address: 'c', notifiedAt: NOW - DAY }), 250),
    row(call({ address: 'd', notifiedAt: NOW - DAY / 2 }), null),
    row(call({ address: 'e', notifiedAt: NOW - 4 * DAY }), 12),
    row(call({ address: 'f', notifiedAt: NOW - 4 * DAY }), 1.4),
  ];
  const b = board(rows, 'week', NOW);
  assert.deepEqual(b.rows.map((r) => r.address), ['c', 'e', 'a', 'f', 'd', 'b']);
  assert.deepEqual(b.record, { calls: 6, twoX: 3, tenX: 2, best: { v: 250 } });
});

test('a window keeps the calls notified inside it; an empty one says so instead of a zero best', () => {
  const rows = [row(call({ address: 'old', notifiedAt: NOW - 20 * DAY }), 50), row(call({ address: 'new', notifiedAt: NOW - DAY }), 2)];
  assert.deepEqual(board(rows, 'week', NOW).rows.map((r) => r.address), ['new']);
  assert.equal(board(rows, 'month', NOW).rows.length, 2);
  assert.equal(board(rows, 'all', NOW).rows.length, 2);
  assert.deepEqual(board([], 'week', NOW).record, { calls: 0, twoX: 0, tenX: 0, best: { v: null, why: 'no_calls' } });
});

test('a recent call is read again within minutes; an old one a few times a day', () => {
  const recent = call({ notifiedAt: NOW - DAY });
  const old = call({ notifiedAt: NOW - 10 * DAY });
  assert.equal(due(recent, undefined, NOW), true);
  assert.equal(due(recent, NOW - 5 * MIN, NOW), false);
  assert.equal(due(recent, NOW - 11 * MIN, NOW), true);
  assert.equal(due(old, NOW - 60 * MIN, NOW), false);
  assert.equal(due(old, NOW - 7 * 60 * MIN, NOW), true);
});

function fakeDb(listed: () => readonly Row[], prices: Row) {
  const asked: string[] = [];
  return {
    asked,
    db: {
      async query(sql: string): Promise<readonly Row[]> {
        asked.push(sql === CALLS_SQL ? 'list' : 'prices');
        return sql === CALLS_SQL ? listed() : [prices];
      },
    },
  };
}

test('the first ask is answered "counting"; after a pass the board is served from memory; a moved notified moment is read again', async () => {
  let notified = NOW - DAY;
  const listed = () => [{ address: 'Coin1pump', notified, notified_cap: 5_000, minted: NOW - DAY - MIN, ticker: 'COIN', image_url: null }];
  const { db, asked } = fakeDb(listed, hist({ hist_peak: 0.00005, hist_traded: 40_000 }));
  const calls = createCalls({ db, log: SILENT, now: () => NOW, origins: ['live_stream'] });
  assert.deepEqual(calls.read('week'), { state: 'counting' });
  await calls.passNow();
  const b = calls.read('week');
  assert.equal(b.state, 'ready');
  if (b.state !== 'ready') return;
  assert.deepEqual(b.rows[0]?.multiple, { v: 10 });
  const before = asked.length;
  await calls.passNow();
  assert.equal(asked.length, before + 1, 'a call read minutes ago is not read again');
  notified = NOW - DAY - 30 * MIN;
  await calls.passNow();
  assert.equal(asked.length, before + 3, 'an earlier notification makes it a new call, read again');
});

test('the route answers a window, and a 404 for anything else', async () => {
  const { db } = fakeDb(() => [], {});
  const calls = createCalls({ db, log: SILENT, now: () => NOW, origins: ['live_stream'] });
  await calls.passNow();
  const ok = await handle('GET', '/calls/month', { db, log: SILENT, calls }, '');
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).state, 'ready');
  assert.equal((await handle('GET', '/calls/year', { db, log: SILENT, calls }, '')).status, 404);
});
