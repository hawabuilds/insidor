import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createCharts, type ChartStorePort, type ChartTick } from './chart.ts';
import type { ChartTake } from './chart-book.ts';

const COIN = 'HwFM5tAJA99h7PDwXYVaXyd8suubFjtvG31rAdVipump';
const SOL = 'So11111111111111111111111111111111111111112';
const T0 = Date.UTC(2026, 9, 27, 12, 0, 0);

const tick = (over: Partial<ChartTick> = {}): ChartTick => ({ coin: COIN, signature: 'sig', side: 'buy', quoteAmount: 0.5, tokens: 1000, trader: 'alice', priceQuote: 0.00001, quoteMint: SOL, pool: 'pump', poolAddress: 'curve1', atMs: T0, ...over });

function ask(charts: ReturnType<typeof createCharts>, url: string): unknown {
  let body = '';
  const res = { writeHead: () => res, end: (b: string) => { body = b; } } as unknown as ServerResponse;
  assert.equal(charts.serve({ url } as IncomingMessage, res), true);
  return JSON.parse(body);
}

test('★ trades are priced at the SOL price of the moment, written, and listed newest first on /trades', async () => {
  const written: ChartTake[] = [];
  const store: ChartStorePort = { charted: async () => [], listed: async () => new Set([COIN]), write: async (t) => void written.push(t), prune: async () => 0 };
  const ac = new AbortController();
  let sol: number | null = 200;
  let wake: () => void = () => undefined;
  const charts = createCharts({ store, solUsd: () => sol, now: () => T0, note: () => undefined, sleep: () => new Promise<void>((r) => { wake = r; }) });
  const running = charts.run(ac.signal);
  await new Promise((r) => setImmediate(r));
  charts.hooks.onTrades(COIN, [tick(), tick({ signature: 'sig2', atMs: T0 + 1000, quoteMint: 'OtherQuote1111111111111111111111111111111111' })], false, T0);
  sol = null;
  charts.hooks.onTrades(COIN, [tick({ signature: 'sig3', atMs: T0 + 2000 })], false, T0);
  wake();
  await new Promise((r) => setImmediate(r));
  ac.abort();
  wake();
  await running;
  const minutes = written.flatMap((t) => t.minutes);
  assert.equal(minutes.length, 1);
  assert.equal(minutes[0]!.o, 0.002, 'SOL price × 200');
  assert.equal(minutes[0]!.volumeUsd, 100);
  assert.equal(minutes[0]!.buys, 1, 'the unpriced trades are not drawn');
  const r = ask(charts, `/trades?coin=${COIN}`) as { held: boolean; trades: { tx: string; usd: number | null }[] };
  assert.equal(r.held, true);
  assert.deepEqual(r.trades.map((t) => [t.tx, t.usd]), [['sig3', null], ['sig2', null], ['sig', 100]]);
  assert.deepEqual(ask(charts, '/trades?coin=nope'), { held: false });
});

test('nothing is folded before the table has answered once', () => {
  const charts = createCharts({ store: { charted: async () => [], listed: async () => new Set(), write: async () => undefined, prune: async () => 0 }, solUsd: () => 200, now: () => T0, note: () => undefined, sleep: async () => undefined });
  charts.hooks.onTrades(COIN, [tick()], true, T0);
  assert.deepEqual(ask(charts, `/trades?coin=${COIN}`), { held: false });
});
