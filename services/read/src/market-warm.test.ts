/**
 * The read-ahead opens each coin in the view a phone opens it on: a coin hours old in the candles
 * its whole life needs, an older one on 1h.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createMarketWarm, openingTimeframe } from './market-warm.ts';

const H = 3_600_000;

test('★ the read-ahead asks for the view a phone opens on', () => {
  assert.equal(openingTimeframe(0, 30 * 60_000), '1m');
  assert.equal(openingTimeframe(0, 5 * H), '5m');
  assert.equal(openingTimeframe(0, 20 * H), '15m');
  assert.equal(openingTimeframe(0, 30 * H), '1h');
  assert.equal(openingTimeframe(null, 0), '1h');
});

test('★ the read-ahead asks as background, so the market source keeps half of each minute for people', async () => {
  const asked: { mint: string; background: boolean }[] = [];
  const warm = createMarketWarm({
    db: { query: async () => [{ address: 'A', minted_ms: 0 }, { address: 'B', minted_ms: null }] } as never,
    log: { info: () => undefined, error: () => undefined } as never,
    market: { coin: async (mint, _tf, options) => { asked.push({ mint, background: options?.background === true }); return { pool: null, candles: [], trades: [] }; } },
    now: () => 30 * 60_000,
  });
  warm.start();
  await new Promise((r) => setTimeout(r, 20));
  warm.stop();
  assert.deepEqual(asked, [{ mint: 'A', background: true }, { mint: 'B', background: true }]);
});
