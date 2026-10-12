import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeCoinMarket } from '../../shared/api/decode.ts';
import { fixtureMarket } from '../../shared/api/fixtures.ts';
import { directionOf } from './direction.ts';

test('the chart is green when the line ends higher and red when it ends lower', () => {
  assert.equal(directionOf([1, 2]), 'up');
  assert.equal(directionOf([2, 1]), 'down');
  assert.equal(directionOf([]), 'flat');
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
