import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChartBook, GATE_TRADES, RECENT_MAX, type ChartTrade } from './chart-book.ts';

const COIN = 'HwFM5tAJA99h7PDwXYVaXyd8suubFjtvG31rAdVipump';
const T0 = Date.UTC(2026, 9, 27, 12, 0, 0);

const trade = (over: Partial<ChartTrade> = {}): ChartTrade => ({
  coin: COIN,
  tx: 'sig',
  side: 'buy',
  tokens: 1000,
  usd: 10,
  priceUsd: 0.001,
  maker: 'alice',
  atMs: T0,
  pool: 'pump',
  poolAddress: 'curve1',
  quoteMint: 'So11111111111111111111111111111111111111112',
  ...over,
});

test('a coin with few trades is held, not written', () => {
  const b = new ChartBook();
  for (let i = 0; i < GATE_TRADES - 1; i += 1) b.apply(trade({ atMs: T0 + i * 1000 }), i === 0, T0);
  const t = b.take();
  assert.equal(t.coins.length, 0);
  assert.equal(t.minutes.length, 0);
  assert.equal(b.recent(COIN), null);
});

test('passing the gate writes every held trade, so the chart starts at the first one', () => {
  const b = new ChartBook();
  for (let i = 0; i < GATE_TRADES; i += 1) b.apply(trade({ atMs: T0 + i * 10_000, priceUsd: 0.001 * (i + 1), tx: `s${i}` }), i === 0, T0);
  const t = b.take();
  assert.equal(t.coins.length, 1);
  assert.equal(t.coins[0]!.fromLaunch, true);
  assert.equal(t.coins[0]!.recordedFromMs, T0);
  const first = t.minutes.find((m) => m.bucketMs === T0)!;
  assert.equal(first.o, 0.001);
  assert.equal(first.c, 0.006);
  assert.equal(first.buys, 6);
  assert.equal(first.volumeUsd, 60);
  assert.equal(t.minutes.reduce((n, m) => n + m.buys, 0), GATE_TRADES);
  assert.equal(t.hours.length, 1);
  assert.equal(t.hours[0]!.buys, GATE_TRADES);
  const r = b.recent(COIN)!;
  assert.equal(r.whole, true);
  assert.equal(r.trades[0]!.tx, `s${GATE_TRADES - 1}`);
});

test('a listed coin is charted on its first trade', () => {
  const b = new ChartBook();
  b.list(new Set([COIN]));
  b.apply(trade(), false, T0);
  assert.equal(b.take().coins.length, 1);
});

test('a take hands over only what is new, and open and close follow the trades\' own times', () => {
  const b = new ChartBook();
  b.list(new Set([COIN]));
  b.apply(trade({ atMs: T0 + 30_000, priceUsd: 2 }), false, T0);
  b.take();
  b.apply(trade({ atMs: T0 + 10_000, priceUsd: 1 }), false, T0);
  b.apply(trade({ atMs: T0 + 50_000, priceUsd: 3, side: 'sell' }), false, T0);
  const d = b.take().minutes[0]!;
  assert.deepEqual([d.o, d.h, d.l, d.c, d.oMs, d.cMs, d.buys, d.sells], [1, 3, 1, 3, 10_000, 50_000, 1, 1]);
  assert.equal(b.take().minutes.length, 0);
});

test('an unpriced trade is listed but never drawn', () => {
  const b = new ChartBook();
  b.list(new Set([COIN]));
  b.apply(trade({ priceUsd: null, usd: null }), false, T0);
  const t = b.take();
  assert.equal(t.minutes.length, 0);
  assert.equal(b.recent(COIN)!.trades.length, 1);
  assert.equal(b.stats().unpriced, 1);
});

test('rows not written come back merged with what arrived since', () => {
  const b = new ChartBook();
  b.list(new Set([COIN]));
  b.apply(trade({ atMs: T0 + 5_000, priceUsd: 2 }), false, T0);
  const failed = b.take();
  b.apply(trade({ atMs: T0 + 1_000, priceUsd: 1 }), false, T0);
  b.restore(failed);
  const t = b.take();
  assert.equal(t.coins.length, 1);
  const m = t.minutes[0]!;
  assert.deepEqual([m.o, m.c, m.buys, m.oMs, m.cMs], [1, 2, 2, 1_000, 5_000]);
});

test('the latest trades are whole only from launch or once full', () => {
  const b = new ChartBook();
  b.remember([{ address: COIN, lastTradeMs: T0 }]);
  b.apply(trade(), false, T0);
  assert.equal(b.recent(COIN)!.whole, false);
  for (let i = 0; i < RECENT_MAX; i += 1) b.apply(trade({ atMs: T0 + i }), false, T0);
  const r = b.recent(COIN)!;
  assert.equal(r.whole, true);
  assert.equal(r.trades.length, RECENT_MAX);
});

test('quiet coins are let go: a held one forgotten, a charted one remembered as charted', () => {
  const b = new ChartBook();
  b.apply(trade({ coin: 'held1' }), false, T0);
  b.list(new Set([COIN]));
  b.apply(trade(), false, T0);
  b.take();
  b.list(new Set());
  b.sweep(T0 + 7 * 3_600_000);
  assert.deepEqual([b.stats().held, b.stats().charted, b.stats().asleep], [0, 0, 1]);
  b.apply(trade({ atMs: T0 + 8 * 3_600_000 }), false, T0 + 8 * 3_600_000);
  assert.equal(b.take().minutes.length, 1);
});
