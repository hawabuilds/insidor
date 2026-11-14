/**
 * readFullCandles (read.ts): a called coin's hours as whole candles with their dollar volume, oldest
 * first, for the calls board's peaks (0171). The high AND the dollars, so a thin print can be told
 * from a top.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFullCandles } from './read.ts';

const reply = (rows: unknown[]) => ({ data: { attributes: { ohlcv_list: rows } } });

test('whole candles with their volume, oldest first, in milliseconds', () => {
  const k = readFullCandles(reply([[7200, 2, 5, 1, 4, 900], [3600, 1, 3, 0.5, 2, '120.5']]));
  assert.deepEqual(k, [
    { t: 3_600_000, o: 1, h: 3, l: 0.5, c: 2, v: 120.5 },
    { t: 7_200_000, o: 2, h: 5, l: 1, c: 4, v: 900 },
  ]);
});

test('a row missing a price is dropped; one missing its volume keeps a null, never a zero', () => {
  const k = readFullCandles(reply([[3600, 1, null, 1, 1, 5], [7200, 1, 2, 1, 1]]));
  assert.deepEqual(k, [{ t: 7_200_000, o: 1, h: 2, l: 1, c: 1, v: null }]);
  assert.deepEqual(readFullCandles(null), []);
});
