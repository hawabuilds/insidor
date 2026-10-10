import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WireLeakError, decodeBoardTick, decodeCoinLink, decodeStory } from './decode.ts';
import { fixtureBoard, fixtureStory, sampleNarrativeIds } from './fixtures.ts';

const row = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'r1',
  title: 't',
  summary: ['a', 'b'],
  thumbUrl: null,
  reach: { v: null, why: 'not_reported' },
  spark: { points: [{ atMs: 1, value: null }], windowMs: 10 },
  momentum: 'rising',
  marketCapUsd: { v: null },
  priceChange24h: { v: null },
  firstSeenAt: { at: null },
  coins: { kind: 'none' },
  isNew: false,
  ...extra,
});

test('an internal word in a payload throws at the boundary rather than being dropped', () => {
  assert.throws(() => decodeBoardTick({ tick: 1, order: [], rows: [row({ score: 0.9 })] }), WireLeakError);
  assert.throws(() => decodeBoardTick({ tick: 1, order: [], rows: [row({ narrative: 'x' })] }), WireLeakError);
});

test('an absence decodes to pending with its reason, and a censored point stays null', () => {
  const tick = decodeBoardTick({ tick: 1, order: ['r1'], rows: [row()] });
  const r = tick.rows[0];
  assert.deepEqual(r?.reach, { known: false, pending: 'not_reported' });
  assert.deepEqual(r?.firstSeenAt, { known: false, pending: 'not_read_yet' });
  assert.equal(r?.spark.points[0]?.value, null);
});

test('an unsure match carries no coin, even if the server sends one', () => {
  const link = decodeCoinLink({ kind: 'unsure', claimCount: 3, coin: { coinId: 'x' } });
  assert.deepEqual(link, { kind: 'unsure', claimCount: 3 });
});

test('a board that does not state its provenance is unstated, never observed', () => {
  assert.deepEqual(decodeBoardTick({ tick: 1, order: [], rows: [] }).provenance, { kind: 'unstated' });
});

test('every fixture decodes through the same decoder as the network', () => {
  const tick = decodeBoardTick(fixtureBoard());
  assert.ok(tick.rows.length >= 8);
  for (const id of [...tick.order, ...sampleNarrativeIds()]) decodeStory(fixtureStory(id));
  assert.equal(fixtureStory('nope'), null);
});

test('the fixtures cover the hard cases, not just the happy one', () => {
  const kinds = new Set(decodeBoardTick(fixtureBoard()).rows.map((r) => r.coins.kind));
  assert.deepEqual([...kinds].sort(), ['none', 'one', 'several', 'unsure']);
  const rows = decodeBoardTick(fixtureBoard()).rows;
  assert.ok(rows.some((r) => !r.reach.known), 'a row with no view count');
  assert.ok(rows.some((r) => !r.firstSeenAt.known), 'a row with no known age');
  assert.ok(rows.some((r) => r.coins.kind === 'one' && !r.coins.coin.tradable), 'a coin that cannot be traded');
});

test('no sample address could be mistaken for a real one', () => {
  for (const id of [...decodeBoardTick(fixtureBoard()).order, ...sampleNarrativeIds()]) {
    const s = decodeStory(fixtureStory(id));
    const coins = s.coins.kind === 'one' ? [s.coins.coin] : s.coins.kind === 'several' ? s.coins.coins : [];
    for (const c of coins) assert.match(c.address, /^SAMPLE/);
  }
});
