import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { decodeCalls } from '../../shared/api/calls.ts';
import { foundLine, missingLine, moneyLine, multipleText, recordCells } from './calls-words.ts';

const MIN = 60_000;
const T = 1_800_000_000_000;

test('a row says when we found it against the coin, never "before launch"', () => {
  assert.equal(foundLine({ foundAt: T, mintedAt: T + 41 * MIN }), 'Found 41m before the coin');
  assert.equal(foundLine({ foundAt: T + 3 * MIN, mintedAt: T }), 'Found 3m after the coin');
  assert.equal(foundLine({ foundAt: T, mintedAt: T + 30_000 }), 'Found as the coin launched');
  assert.equal(foundLine({ foundAt: T, mintedAt: T + 2 * 24 * 60 * MIN }), 'Found 2d before the coin');
});

test('a multiple is whole from 10x up and one decimal under it, never rounded up to a bigger run', () => {
  assert.equal(multipleText(2268.4), '2,268x');
  assert.equal(multipleText(10), '10x');
  assert.equal(multipleText(9.99), '9.9x');
  assert.equal(multipleText(1.04), '1.0x');
});

test('the money line runs from the start to the peak; with either missing there is none', () => {
  assert.equal(moneyLine({ startUsd: 5_000, peakUsd: 2_060_000 }), '$5K → $2.06M');
  assert.equal(moneyLine({ startUsd: 5_000, peakUsd: 20_600_000 }), '$5K → $21M', 'the app\'s own money format, as everywhere else');
  assert.equal(moneyLine({ startUsd: null, peakUsd: 20_600_000 }), null);
  assert.equal(missingLine({ missing: 'thin_trading' }), 'Little money traded');
  assert.equal(missingLine({ missing: 'not_recorded' }), 'Price not recorded');
});

test('the record strip draws a dash for an unknown share or best, never a 0', () => {
  const cells = recordCells({ calls: 0, tenX: 0, earlyShare: null, best: null });
  assert.deepEqual(cells.map((c) => c.value), ['0', '0', '—', '—']);
  assert.deepEqual(recordCells({ calls: 142, tenX: 31, earlyShare: 0.64, best: 2268 }).map((c) => c.value), ['142', '31', '64%', '2,268x']);
});

test('the reply decodes in the server order; a missing multiple keeps its reason and a bad row is dropped alone', () => {
  const calls = decodeCalls({
    state: 'ready',
    window: 'week',
    record: { calls: 3, tenX: 1, earlyShare: { v: 0.5 }, best: { v: 40 } },
    rows: [
      { address: 'A1pump', ticker: '$COGE', imageUrl: 'https://x/a.png', foundAt: T, mintedAt: T + MIN, early: true, startUsd: { v: 5_000 }, peakUsd: { v: 200_000 }, multiple: { v: 40 } },
      { address: 'B1pump', ticker: 'THIN', imageUrl: null, foundAt: T, mintedAt: T - MIN, early: false, startUsd: { v: 5_000 }, peakUsd: { v: null, why: 'thin_trading' }, multiple: { v: null, why: 'thin_trading' } },
      { address: 'C1pump', ticker: 'helius', imageUrl: null, foundAt: T, mintedAt: T, early: false, startUsd: { v: null, why: 'not_recorded' }, peakUsd: { v: null, why: 'not_recorded' }, multiple: { v: null, why: 'not_recorded' } },
      { address: 'D1pump', ticker: 'NOTIME', foundAt: null, mintedAt: T },
    ],
  });
  assert.equal(calls.state, 'ready');
  if (calls.state !== 'ready') return;
  assert.deepEqual(calls.rows.map((r) => r.address), ['A1pump', 'B1pump']);
  assert.equal(calls.rows[0]?.ticker, 'COGE');
  assert.equal(calls.rows[0]?.missing, null);
  assert.equal(calls.rows[1]?.multiple, null);
  assert.equal(calls.rows[1]?.missing, 'thin_trading');
  assert.deepEqual(calls.record, { calls: 3, tenX: 1, earlyShare: 0.5, best: 40 });
});

test('a reply still counting is "counting", whatever else it carries', () => {
  assert.deepEqual(decodeCalls({ state: 'counting' }), { state: 'counting' });
  assert.deepEqual(decodeCalls(null), { state: 'counting' });
});
