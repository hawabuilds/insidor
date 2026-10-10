import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeCoin } from './api/decode.ts';
import { coinLabels } from './coin-facts.ts';

const coin = (id: string, mcap: number | null, minted: number | null) =>
  decodeCoin({
    coinId: id, ticker: 'T', name: 'T', address: 'SAMPLE', venueLabel: 'pump.fun', imageUrl: null,
    mintedAt: { at: minted }, priceUsd: { v: 1 }, marketCapUsd: { v: mcap }, marketCapBasis: null,
    liquidityUsd: { v: null }, priceChange24h: { v: null }, tradable: true,
  });

test('the biggest and the first are labelled when every figure is known', () => {
  const labels = coinLabels([coin('a', 4300, 200), coin('b', 4100, 100), coin('c', 900, 300)]);
  assert.deepEqual(labels.get('a'), ['biggest']);
  assert.deepEqual(labels.get('b'), ['first']);
  assert.equal(labels.get('c'), undefined);
});

test('one unknown market cap means nobody is the biggest', () => {
  const labels = coinLabels([coin('a', 4300, 200), coin('b', null, 100)]);
  assert.equal(labels.get('a'), undefined);
  assert.deepEqual(labels.get('b'), ['first']);
});

test('one unknown mint time means nobody is first', () => {
  assert.equal([...coinLabels([coin('a', 1, null), coin('b', 2, 100)]).values()].flat().includes('first'), false);
});

test('a tie is not a winner, and a lone coin is not "biggest" of one', () => {
  assert.equal(coinLabels([coin('a', 5, 1), coin('b', 5, 2)]).get('a')?.includes('biggest') ?? false, false);
  assert.equal(coinLabels([coin('a', 5, 1)]).size, 0);
});
