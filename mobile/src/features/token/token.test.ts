import { test } from 'node:test';
import assert from 'node:assert/strict';

import { directionOf, sampleSeries, sampleTrades } from './sample-market.ts';

test('the same coin draws the same chart every time', () => {
  assert.deepEqual(sampleSeries('c1', '1H', 0.0000043), sampleSeries('c1', '1H', 0.0000043));
});

test('the series ends at the current price', () => {
  const s = sampleSeries('c1', '5M', 0.5);
  assert.equal(s[s.length - 1], 0.5);
});

test('the chart is green when the line ends higher and red when it ends lower', () => {
  assert.equal(directionOf([1, 2]), 'up');
  assert.equal(directionOf([2, 1]), 'down');
  assert.equal(directionOf([]), 'flat');
});

test('sample trades carry no transaction id that could be looked up', () => {
  for (const t of sampleTrades()) assert.deepEqual(Object.keys(t).sort(), ['ago', 'side', 'sol', 'tokens', 'usd']);
});
