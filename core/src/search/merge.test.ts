import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';
import { mergeHits } from './merge.ts';

const hit = (over: Partial<CoinSearchHit>): CoinSearchHit => ({
  address: 'A', name: null, ticker: null, venue: 'curve', marketAddress: null, createdAt: null, marketCapUsd: null, imageUrl: null, source: 's1', ...over,
});

test('one coin per address, each gap filled from the other source and never guessed', () => {
  const merged = mergeHits([[hit({ name: 'Jimothy', imageUrl: 'i' })], [hit({ ticker: 'JIM', marketCapUsd: 5 }), hit({ address: 'B' })]]);
  assert.equal(merged.length, 2);
  assert.deepEqual({ ...merged[0], source: 'x' }, { ...hit({ name: 'Jimothy', imageUrl: 'i', ticker: 'JIM', marketCapUsd: 5 }), source: 'x' });
  assert.equal(merged[1]?.createdAt, null);
});

test('★ a coin that bonded is bonded, whichever source answered first', () => {
  const [m] = mergeHits([[hit({ venue: 'curve', marketAddress: 'curve', name: 'Jim' })], [hit({ venue: 'pool', marketAddress: 'pool' })]]);
  assert.equal(m?.venue, 'pool');
  assert.equal(m?.marketAddress, 'pool');
  assert.equal(m?.name, 'Jim');
});

test('a curve account is never borrowed for a pool', () => {
  const [m] = mergeHits([[hit({ venue: 'pool', marketAddress: null })], [hit({ venue: 'curve', marketAddress: 'curve' })]]);
  assert.equal(m?.marketAddress, null);
});

test('★ the launch is the earliest time any source knows, never a pool made later', () => {
  const curve = hit({ address: 'M', venue: 'curve', createdAt: 1_000 });
  const pool = hit({ address: 'M', venue: 'pool', createdAt: 9_000 });
  assert.equal(mergeHits([[pool], [curve]])[0]?.createdAt, 1_000);
  assert.equal(mergeHits([[{ ...pool, createdAt: null }], [curve]])[0]?.createdAt, 1_000);
});
