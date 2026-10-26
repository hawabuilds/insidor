import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CoinMarket } from '../../shared/api/index.ts';
import type { LiveTrade } from '../../shared/live-coins.ts';
import { withLiveTrades } from './live-market.ts';

const MIN = 60_000;
const T0 = 1_793_000_000_000 - (1_793_000_000_000 % MIN);
const read = (o: Partial<Extract<CoinMarket, { kind: 'read' }>> = {}): CoinMarket => ({
  kind: 'read', timeframe: '1m', venue: 'curve', curveProgress: null, pair: null, coin: null,
  candles: [{ t: T0, o: 1, h: 1.2, l: 0.9, c: 1.1 }],
  trades: [{ tx: 'old', side: 'buy', tokenAmount: { known: true, amount: 10 }, usd: { known: true, amount: 11 }, priceUsd: { known: true, amount: 1.1 }, at: { known: true, at: T0 + 10_000 }, maker: 'w0' }],
  ...o,
} as CoinMarket);
const trade = (x: string, at: number, p: number, s: 'b' | 's' = 'b'): LiveTrade => ({ a: 'COIN', s, q: 0.1, k: 5, w: 'w1', c: p * 1e9, p, cq: null, t: at, x, o: 'pump' });

test('★ a trade inside the last period moves its high, low and close; the next period opens a candle', () => {
  const m = withLiveTrades(read(), [trade('a', T0 + 20_000, 1.5), trade('b', T0 + 30_000, 0.8, 's'), trade('c', T0 + MIN + 5_000, 1.3)], '1m');
  assert.ok(m !== null && m.kind === 'read');
  assert.deepEqual(m.candles, [{ t: T0, o: 1, h: 1.5, l: 0.8, c: 0.8 }, { t: T0 + MIN, o: 0.8, h: 1.3, l: 0.8, c: 1.3 }]);
  assert.deepEqual(m.trades?.map((t) => t.tx), ['c', 'b', 'a', 'old'], 'newest on top, then the read');
});

test('a trade the read already has, or older than its newest, is not laid on again', () => {
  const m = withLiveTrades(read(), [trade('old', T0 + 10_000, 9), trade('older', T0 + 5_000, 9)], '1m');
  assert.ok(m !== null && m.kind === 'read');
  assert.deepEqual(m.candles, [{ t: T0, o: 1, h: 1.2, l: 0.9, c: 1.1 }]);
  assert.deepEqual(m.trades?.map((t) => t.tx), ['old']);
});

test('nothing read, or nothing live: the read as it is', () => {
  assert.equal(withLiveTrades(null, [trade('a', T0, 1)], '1m'), null);
  const r = read();
  assert.equal(withLiveTrades(r, [], '1m'), r);
});
