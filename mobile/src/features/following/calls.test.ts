import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { decodeCalls } from '../../shared/api/calls.ts';
import { bestLabel, missingLine, moneyLine, multipleText, notifiedLine, recordCells } from './calls-words.ts';

const MIN = 60_000;
const T = 1_800_000_000_000;

test('a row says when we told people against the coin launch', () => {
  assert.equal(notifiedLine({ mintedAt: T, notifiedAt: T + 3 * MIN }), 'Notified 3m after launch');
  assert.equal(notifiedLine({ mintedAt: T, notifiedAt: T + 30_000 }), 'Notified at launch');
  assert.equal(notifiedLine({ mintedAt: T, notifiedAt: T - MIN }), 'Notified at launch', 'a clock a little off is never "before launch"');
  assert.equal(notifiedLine({ mintedAt: T, notifiedAt: T + 26 * 60 * MIN }), 'Notified 1d after launch');
});

test('a multiple is whole from 10x up and one decimal under it, never rounded up to a bigger run', () => {
  assert.equal(multipleText(2268.9), '2,268x');
  assert.equal(multipleText(10), '10x');
  assert.equal(multipleText(9.99), '9.9x');
  assert.equal(multipleText(1.04), '1.0x');
});

test('the money line runs from the cap we told people to the peak; with either missing there is none', () => {
  assert.equal(moneyLine({ startUsd: 12_000, peakUsd: 2_060_000 }), '$12K → $2.06M');
  assert.equal(moneyLine({ startUsd: 5_000, peakUsd: 20_600_000 }), '$5K → $21M', "the app's own money format, as everywhere else");
  assert.equal(moneyLine({ startUsd: null, peakUsd: 20_600_000 }), null);
  assert.equal(missingLine({ missing: 'thin_trading' }), 'Little money traded');
  assert.equal(missingLine({ missing: 'not_recorded' }), 'Price not recorded');
});

test('the headline card names its window and counts the calls, the doubles and the 10x', () => {
  assert.equal(bestLabel('week'), 'Best call this week');
  assert.equal(bestLabel('all'), 'Best call of all time');
  assert.deepEqual(recordCells({ calls: 1142, twoX: 54, tenX: 31, best: 792 }).map((c) => c.value), ['1,142', '54', '31']);
});

test('the reply decodes in the server order; a missing multiple keeps its reason and a bad row is dropped alone', () => {
  const calls = decodeCalls({
    state: 'ready',
    window: 'week',
    record: { calls: 3, twoX: 1, tenX: 1, best: { v: 40 } },
    rows: [
      { address: 'A1pump', ticker: '$COGE', imageUrl: 'https://x/a.png', notifiedAt: T + MIN, mintedAt: T, startUsd: { v: 5_000 }, peakUsd: { v: 200_000 }, multiple: { v: 40 } },
      { address: 'B1pump', ticker: 'THIN', imageUrl: null, notifiedAt: T, mintedAt: T, startUsd: { v: 5_000 }, peakUsd: { v: null, why: 'thin_trading' }, multiple: { v: null, why: 'thin_trading' } },
      { address: 'C1pump', ticker: 'helius', imageUrl: null, notifiedAt: T, mintedAt: T, startUsd: { v: null, why: 'not_recorded' }, peakUsd: { v: null, why: 'not_recorded' }, multiple: { v: null, why: 'not_recorded' } },
      { address: 'D1pump', ticker: 'NOTIME', notifiedAt: null, mintedAt: T },
    ],
  });
  assert.equal(calls.state, 'ready');
  if (calls.state !== 'ready') return;
  assert.deepEqual(calls.rows.map((r) => r.address), ['A1pump', 'B1pump']);
  assert.equal(calls.rows[0]?.ticker, 'COGE');
  assert.equal(calls.rows[0]?.missing, null);
  assert.equal(calls.rows[1]?.multiple, null);
  assert.equal(calls.rows[1]?.missing, 'thin_trading');
  assert.deepEqual(calls.record, { calls: 3, twoX: 1, tenX: 1, best: 40 });
});

test('a reply still counting is "counting", whatever else it carries', () => {
  assert.deepEqual(decodeCalls({ state: 'counting' }), { state: 'counting' });
  assert.deepEqual(decodeCalls(null), { state: 'counting' });
});
