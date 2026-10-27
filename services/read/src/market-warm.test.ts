/**
 * The read-ahead opens each coin in the view a phone opens it on: a coin hours old in the candles
 * its whole life needs, an older one on 1h.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openingTimeframe } from './market-warm.ts';

const H = 3_600_000;

test('★ the read-ahead asks for the view a phone opens on', () => {
  assert.equal(openingTimeframe(0, 30 * 60_000), '1m');
  assert.equal(openingTimeframe(0, 5 * H), '5m');
  assert.equal(openingTimeframe(0, 20 * H), '15m');
  assert.equal(openingTimeframe(0, 30 * H), '1h');
  assert.equal(openingTimeframe(null, 0), '1h');
});
