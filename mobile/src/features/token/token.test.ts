import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeCoinMarket } from '../../shared/api/decode.ts';
import { fixtureMarket } from '../../test-fixtures/fixtures.ts';
import type { MarketTrade } from '../../shared/api/index.ts';
import { candleFromPoint, changePctForPoints, defaultTimeframe, gapBreakMsForWindow, chartWindowMs, hoveredCandleChangePct, isHistoryPrepend, isLiveEdgeUpdate, mergeTradesIntoChart, shouldAutoFit, toLineData, withCompressedBreaks, type ChartPoint } from './chart-data.ts';
import { chartNote } from './chart-format.ts';

const MIN = 60_000;
const p = (t: number, price: number, extra: Partial<ChartPoint> = {}): ChartPoint => ({ t, price, ...extra });
const fill = (at: number, priceUsd: number, usd = 5): MarketTrade => ({ tx: null, side: 'buy', tokenAmount: { known: true, amount: usd / priceUsd }, usd: { known: true, amount: usd }, priceUsd: { known: true, amount: priceUsd }, at: { known: true, at: at as never }, maker: null });

test('the header move: across the view, or inside the one candle under the finger', () => {
  assert.equal(changePctForPoints([p(0, 1), p(MIN, 1.5)]), 50);
  assert.equal(changePctForPoints([p(0, 1)]), null, 'one candle is no move');
  const points = [p(0, 1, { open: 1 }), p(MIN, 2, { open: 1.6 })];
  assert.equal(hoveredCandleChangePct(points, points[1] as ChartPoint), 25, 'its own open to close, not since the view began');
});

test('★ a bad print is dropped, never drawn as a wick', () => {
  const c = candleFromPoint(p(0, 1, { open: 1, high: 500, low: 0.9 }));
  assert.equal(c.high, 1, 'a high five hundred times the close is a wrong-decimal report');
  assert.equal(c.low, 0.9);
  assert.deepEqual(toLineData([p(0, 0), p(MIN, 1)]).map((d) => d.value), [1], 'a zero price is not drawn');
});

test('★ a hole stays a hole: a long silence breaks the line in a few empty slots, never a made-up price', () => {
  const bars = [{ time: 0, value: 1 }, { time: 86_400, value: 2 }];
  const out = withCompressedBreaks(bars, [0, 86_400_000], gapBreakMsForWindow(chartWindowMs('1h')));
  assert.equal(out.length, 5);
  assert.ok(out.slice(1, 4).every((b) => !('value' in b)), 'the slots carry no price');
  assert.equal(withCompressedBreaks(bars, [0, 86_400_000], gapBreakMsForWindow(chartWindowMs('1m'))).length, 2, 'on 1m an empty stretch is normal and the line stays joined');
});

test('★ the view moves only when asked: a live tick or older history leaves a pan where it is', () => {
  const a = [p(0, 1), p(MIN, 2)];
  assert.equal(isLiveEdgeUpdate(a, [p(0, 1), p(MIN, 2.5)]), true);
  assert.equal(isLiveEdgeUpdate(a, [p(0, 1), p(MIN, 2), p(2 * MIN, 3)]), true);
  assert.equal(isLiveEdgeUpdate(a, [p(0, 9), p(MIN, 2)]), false, 'an older candle changing is a redraw');
  assert.equal(isHistoryPrepend(a, [p(-MIN, 1), ...a]), true);
  assert.equal(shouldAutoFit({ hasFitted: true, liveEdge: true, prepend: false, identityChanged: false }), false);
  assert.equal(shouldAutoFit({ hasFitted: false, liveEdge: false, prepend: false, identityChanged: false }), true);
  assert.equal(shouldAutoFit({ hasFitted: true, liveEdge: false, prepend: false, identityChanged: true }), true, 'a new timeframe or style fits again');
});

test('the latest trades move the newest candle, and open the next one where the last closed', () => {
  const candles = [p(0, 1, { open: 1, high: 1, low: 1 }), p(MIN, 2, { open: 1, high: 2, low: 1 })];
  const same = mergeTradesIntoChart(candles, [fill(MIN + 10_000, 2.4)], MIN);
  assert.deepEqual(same[1], { t: MIN, price: 2.4, open: 1, high: 2.4, low: 1 });
  const next = mergeTradesIntoChart(candles, [fill(2 * MIN + 5_000, 1.8)], MIN);
  assert.deepEqual(next[2], { t: 2 * MIN, price: 1.8, open: 2, high: 2, low: 1.8 });
  assert.equal(mergeTradesIntoChart(candles, [fill(10_000, 9)], MIN).length, 2, 'a trade before the newest candle never redraws an indexed one');
  assert.equal(mergeTradesIntoChart(candles, [fill(MIN + 1, 2000)], MIN)[1]?.price, 2, 'a thousandfold print is dropped');
});

test("Trador's first view: 1m for a coin on its curve or under a day old, 1h otherwise", () => {
  const now = 10 * 86_400_000;
  assert.equal(defaultTimeframe({ onCurve: true, launchedAt: null, now }), '1m');
  assert.equal(defaultTimeframe({ onCurve: false, launchedAt: now - 3_600_000, now }), '1m');
  assert.equal(defaultTimeframe({ onCurve: false, launchedAt: now - 3 * 86_400_000, now }), '1h');
  assert.equal(defaultTimeframe({ onCurve: false, launchedAt: null, now }), '1h', 'an unknown age is not young');
});

test('an empty chart says why: loading, unread, or too little history for the view', () => {
  assert.equal(chartNote('loading', null, '1h'), 'Loading price history.');
  assert.equal(chartNote('ready', { kind: 'unavailable', timeframe: '1h' }, '1h'), 'Price history could not be read just now.');
  assert.equal(chartNote('ready', { kind: 'read', timeframe: '4h', venue: 'pool', candles: [], trades: [], curveProgress: null }, '4h'), 'Not enough history for 4h');
});

test('★ a sample market: the same chart every time, and trades with no transaction that could be looked up', () => {
  const a = decodeCoinMarket(fixtureMarket('c_ferry', '1h'));
  assert.deepEqual(a, decodeCoinMarket(fixtureMarket('c_ferry', '1h')));
  assert.equal(a.kind, 'read');
  if (a.kind !== 'read') return;
  assert.ok((a.candles?.length ?? 0) > 1);
  for (const t of a.trades ?? []) assert.equal(t.tx, null);
});

test('★ an outage is not an empty market, and a candle missing a number is dropped, never drawn at zero', () => {
  assert.deepEqual(decodeCoinMarket({ kind: 'unavailable', timeframe: '5m' }), { kind: 'unavailable', timeframe: '5m' });
  const m = decodeCoinMarket({ kind: 'read', timeframe: '1m', venue: 'curve', candles: [{ t: 1, o: 1, h: 1, l: 1, c: null }, { t: 2, o: 1, h: 2, l: 1, c: 2 }], trades: [{ tx: 'x', side: 'maybe' }], curveProgress: { v: 0.2 } });
  assert.equal(m.kind === 'read' && m.candles?.length, 1);
  assert.equal(m.kind === 'read' && m.trades?.length, 0, 'a trade with an unknown side is not coloured as either');
  assert.deepEqual(m.kind === 'read' && m.curveProgress, { known: true, amount: 0.2 });
});
