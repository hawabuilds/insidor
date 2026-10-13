/**
 * The missed-posts list on the phone: a row with every field is kept, a row missing one is dropped
 * rather than drawn half, and an unknown tone is not guessed at.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { decodeMissed } from './missed.ts';

const ROW = { id: '1', url: 'https://x.com/a/status/1', addedAt: 1_800_000_000_000, postedAt: null, headline: 'Never found', tone: 'missed', lines: ['Not in our search.'], coins: [{ address: 'abc', name: 'cat', ticker: 'CAT', launchedAt: null }, { name: 'no address' }] };

test('a whole row is kept with its coins; a coin with no address is dropped', () => {
  const list = decodeMissed({ max: 10, suggestion: null, posts: [ROW] });
  assert.equal(list.max, 10);
  assert.equal(list.posts.length, 1);
  assert.deepEqual(list.posts[0]?.coins.map((c) => c.address), ['abc']);
});

test('a row missing a field, or with a tone we do not know, is dropped', () => {
  const { headline: _h, ...noHeadline } = ROW;
  const list = decodeMissed({ max: 10, suggestion: 'look back longer', posts: [noHeadline, { ...ROW, tone: 'great' }] });
  assert.equal(list.posts.length, 0);
  assert.equal(list.suggestion, 'look back longer');
});
