import { test } from 'node:test';
import assert from 'node:assert/strict';

import { freeFirst, tickerAddresses, tickerUse } from './name-ideas.ts';

const hit = (address: string, ticker: string | null) => ({ address, name: null, ticker, venue: 'curve' as const, marketAddress: null, createdAt: null, marketCapUsd: null, imageUrl: null, source: 's' });

test('a ticker counts the coins under exactly it, from the index and the sources together', () => {
  const set = tickerAddresses('stork', ['A'], [hit('A', 'STORK'), hit('B', 'stork'), hit('C', 'STORKY')]);
  assert.deepEqual([...set].sort(), ['A', 'B']);
});

test('★ free only when every source answered; an outage with nothing found is unknown, never free', () => {
  assert.deepEqual(tickerUse(new Set(), 0, false), { kind: 'free' });
  assert.deepEqual(tickerUse(new Set(), 1, false), { kind: 'unknown' });
  assert.deepEqual(tickerUse(new Set(['A', 'B']), 1, true), { kind: 'taken', count: 2, more: true });
});

test('free first, then unknown, then taken, each in the projector order', () => {
  const idea = (ticker: string, use: Parameters<typeof freeFirst>[0][number]['use']) => ({ name: ticker, ticker, use });
  const out = freeFirst([idea('A', { kind: 'taken', count: 1, more: false }), idea('B', { kind: 'free' }), idea('C', { kind: 'unknown' }), idea('D', { kind: 'free' })]);
  assert.deepEqual(out.map((i) => i.ticker), ['B', 'D', 'C', 'A']);
});
