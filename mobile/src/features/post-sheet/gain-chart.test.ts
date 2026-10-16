/** The views-gained chart's rules (gain-chart.ts) and the fact line's market move (mc-change.ts). */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CoinMarket } from '../../shared/api/index.ts';
import { buckets, firstWords, gapText, lastGain, launchTime, placePills, postSlots } from './gain-chart.ts';
import { MIN_TRADES, mcChange, pctText } from './mc-change.ts';

const M = 60_000;
const NOW = 1_000 * M;

test('★ a post found late with a million views has no spike: its gain counts from its first reading', () => {
  const r = [{ atMs: NOW - 30 * M, value: 1_000_000 }, { atMs: NOW - 20 * M, value: 1_010_000 }, { atMs: NOW - 10 * M, value: 1_020_000 }, { atMs: NOW, value: 1_030_000 }];
  const s = postSlots(r, NOW);
  assert.ok(s);
  assert.ok(s.values.every((v) => v === 5_000), 'every five minutes holds its share of 10K a ten minutes, nothing more');
  assert.equal(lastGain(s, '15m'), 15_000);
});

test('★ a gain between two far-apart readings is spread over the time between them; after the last reading nothing is guessed', () => {
  const s = postSlots([{ atMs: NOW - 60 * M, value: 0 }, { atMs: NOW - 30 * M, value: 60_000 }], NOW);
  assert.ok(s);
  const b = buckets(s, 15 * M);
  assert.deepEqual(b.map((x) => x.value), [30_000, 30_000, 0, null], 'the slot of the last reading adds nothing after it; the half hour after is a gap, not a zero');
});

test('buckets end at the newest slot and drop the ones that end before the span', () => {
  const s = { fromMs: NOW - 60 * M, stepMs: 5 * M, values: Array.from({ length: 12 }, () => 10) };
  assert.deepEqual(buckets(s, 60 * M).map((b) => [b.start, b.end, b.value]), [[NOW - 60 * M, NOW, 120]]);
  assert.equal(buckets(s, 15 * M, NOW - 30 * M).length, 2);
});

test('★ a launch is printed to the minute only from a clock we trust, and both minutes when the doubt crosses one', () => {
  const at = new Date(2026, 9, 17, 14, 22, 30).getTime();
  const now = new Date(2026, 9, 17, 18, 0).getTime();
  assert.deepEqual(launchTime(at, { kind: 'chain' }, now), { kind: 'at', at, earliest: at, latest: at, text: '14:22' });
  assert.equal((launchTime(at, { kind: 'within', withinS: 3 }, now) as { text: string }).text, '14:22');
  assert.equal((launchTime(at, { kind: 'within', withinS: 40 }, now) as { text: string }).text, '14:21 to 14:23');
  assert.deepEqual(launchTime(at, { kind: 'unknown' }, now), { kind: 'unknown' });
});

test('★ "Found before" only when we really were first; the coin first is said the other way; inside the doubt, neither', () => {
  const coin = launchTime(NOW, { kind: 'within', withinS: 5 }, NOW);
  assert.deepEqual(firstWords(NOW - 58 * M, coin, '$GTA'), { lead: 'Found', gap: '57m before', tail: '$GTA' }, 'measured to the earliest the coin can have been made');
  assert.deepEqual(firstWords(NOW + 6 * M + 30_000, coin, '$GTA'), { lead: 'Coin was', gap: '6m before', tail: 'we found it' });
  assert.equal(firstWords(NOW + 2_000, coin, '$GTA'), null);
  assert.equal(firstWords(NOW, { kind: 'unknown' }, '$GTA'), null);
  assert.equal(gapText(59 * M + 59_000), '59m', 'cut down, never rounded up');
  assert.equal(gapText(1198 * 60 * M + 17 * M), '49d 22h');
});

test('★ two pills that would overlap go on two rows, never hidden', () => {
  const p = placePills([{ key: 'a', text: 'First found 13:24', x: 30 }, { key: 'b', text: '$GTA launched 14:22', x: 70 }], 340);
  assert.deepEqual(p.map((x) => x.row), [0, 1]);
  const apart = placePills([{ key: 'a', text: 'Found 13:24', x: 20 }, { key: 'b', text: '$GTA 14:22', x: 300 }], 340);
  assert.deepEqual(apart.map((x) => x.row), [0, 0]);
});

test('★ the market move is hidden until the coin has enough trades, and is price against price an interval back', () => {
  const candles = Array.from({ length: 20 }, (_, i) => ({ t: NOW - (20 - i) * M, o: 1, h: 1, l: 1, c: 1 + i / 100 }));
  const trades = (n: number) => Array.from({ length: n }, () => ({ tx: null, side: 'buy' as const, tokenAmount: { known: false as const, pending: 'not_reported' as const }, usd: { known: false as const, pending: 'not_reported' as const }, priceUsd: { known: false as const, pending: 'not_reported' as const }, at: { known: false as const, pending: 'not_reported' as const }, maker: null }));
  const market = (n: number): CoinMarket => ({ kind: 'read', timeframe: '1m', venue: 'pool', candles, trades: trades(n), curveProgress: null });
  assert.equal(mcChange(market(MIN_TRADES - 1), '5m'), null);
  const p = mcChange(market(MIN_TRADES), '5m');
  assert.ok(p !== null && Math.abs(p - ((1.19 / 1.14 - 1) * 100)) < 1e-9);
  assert.equal(mcChange(market(MIN_TRADES), '1h'), null, 'nothing a whole hour back');
  assert.equal(pctText(12.4), '+12%');
  assert.equal(pctText(-4.46), '-4.5%');
});
