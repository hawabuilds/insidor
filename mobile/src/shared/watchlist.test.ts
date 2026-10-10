import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWatchlist, type Storage } from './watchlist.ts';

const memory = (): Storage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

test('a star survives being read back', () => {
  const s = memory();
  createWatchlist(s).toggle('st_goose');
  assert.deepEqual(createWatchlist(s).ids(), ['st_goose']);
});

test('toggling twice removes it', () => {
  const w = createWatchlist(memory());
  w.toggle('a');
  w.toggle('a');
  assert.equal(w.has('a'), false);
});

test('a broken or refusing store degrades to an empty list, not a crash', () => {
  const broken: Storage = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); } };
  const w = createWatchlist(broken);
  assert.deepEqual(w.ids(), []);
  w.toggle('a');
  assert.equal(w.has('a'), true);
  assert.deepEqual(createWatchlist(null).ids(), []);
});
