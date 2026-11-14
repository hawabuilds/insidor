import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { decodeCalls } from '../../shared/api/calls.ts';
import { launchLine, missingLine, moneyLine, multipleText, recordCells } from './calls-words.ts';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T = 1_800_000_000_000;

test('under the ticker: how early we saw the post against the launch, and nothing else', () => {
  assert.equal(launchLine({ foundAt: T - 2 * 60 * MIN, mintedAt: T, notifiedAt: T + MIN }, T + DAY), '2h before launch');
  assert.equal(launchLine({ foundAt: T + 4 * 60 * MIN, mintedAt: T, notifiedAt: T + 5 * 60 * MIN }, T + DAY), '4h after launch');
  assert.equal(launchLine({ foundAt: T + 20_000, mintedAt: T, notifiedAt: T + MIN }, T + DAY), 'At launch');
  assert.equal(launchLine({ foundAt: null, mintedAt: T, notifiedAt: T }, T + 5 * DAY), '5d ago', 'no sighting recorded: how long ago we told people');
});

test('a multiple is whole from 10x up and one decimal under it, never rounded up to a bigger run', () => {
  assert.equal(multipleText(2268.9), '2,268x');
  assert.equal(multipleText(10), '10x');
  assert.equal(multipleText(9.99), '9.9x');
  assert.equal(multipleText(1.04), '1.0x');
});

test('the money line runs from the cap we told people to the peak; with either missing there is none', () => {
  assert.equal(moneyLine({ startUsd: 19_000, peakUsd: 590_000 }), '$19K → $590K');
  assert.equal(moneyLine({ startUsd: 5_000, peakUsd: 20_600_000 }), '$5K → $21M', "the app's own money format, as everywhere else");
  assert.equal(moneyLine({ startUsd: null, peakUsd: 20_600_000 }), null);
  assert.equal(missingLine({ missing: 'thin_trading' }), 'Little money traded');
  assert.equal(missingLine({ missing: 'not_recorded' }), 'Price not recorded');
});

test('the strip counts the calls, the doubles and the 10x, and shows the best green; a missing best is a dash', () => {
  const cells = recordCells({ calls: 1142, twoX: 54, tenX: 31, best: 30.7 });
  assert.deepEqual(cells.map((c) => c.value), ['1,142', '54', '31', '30x']);
  assert.deepEqual(cells.map((c) => c.up), [false, false, false, true]);
  assert.equal(recordCells({ calls: 0, twoX: 0, tenX: 0, best: null })[3]?.value, '—');
});

test('the reply decodes in the server order with each found time; a missing multiple keeps its reason and a bad row is dropped alone', () => {
  const calls = decodeCalls({
    state: 'ready',
    window: 'week',
    record: { calls: 3, twoX: 1, tenX: 1, best: { v: 40 } },
    rows: [
      { address: 'A1pump', ticker: '$COGE', imageUrl: 'https://x/a.png', notifiedAt: T + MIN, foundAt: T - 60 * MIN, mintedAt: T, startUsd: { v: 5_000 }, peakUsd: { v: 200_000 }, multiple: { v: 40 } },
      { address: 'B1pump', ticker: 'THIN', imageUrl: null, notifiedAt: T, mintedAt: T, startUsd: { v: 5_000 }, peakUsd: { v: null, why: 'thin_trading' }, multiple: { v: null, why: 'thin_trading' } },
      { address: 'C1pump', ticker: 'helius', imageUrl: null, notifiedAt: T, mintedAt: T, startUsd: { v: null, why: 'not_recorded' }, peakUsd: { v: null, why: 'not_recorded' }, multiple: { v: null, why: 'not_recorded' } },
      { address: 'D1pump', ticker: 'NOTIME', notifiedAt: null, mintedAt: T },
    ],
  });
  assert.equal(calls.state, 'ready');
  if (calls.state !== 'ready') return;
  assert.deepEqual(calls.rows.map((r) => r.address), ['A1pump', 'B1pump']);
  assert.equal(calls.rows[0]?.ticker, 'COGE');
  assert.equal(calls.rows[0]?.foundAt, T - 60 * MIN);
  assert.equal(calls.rows[1]?.foundAt, null, 'a row sent without its found time keeps none');
  assert.equal(calls.rows[1]?.missing, 'thin_trading');
  assert.deepEqual(calls.record, { calls: 3, twoX: 1, tenX: 1, best: 40 });
});

test('a reply still counting is "counting", whatever else it carries', () => {
  assert.deepEqual(decodeCalls({ state: 'counting' }), { state: 'counting' });
  assert.deepEqual(decodeCalls(null), { state: 'counting' });
});
