/**
 * For You's order and the order model's bar, as the projector applies them: highest number first,
 * newest first on a tie or with no fit; the bar holds a post back only when set, with a fit, and
 * never over the owner's "meme" call. The number itself is never on a row: WireRisingPost has no
 * field for it, and projectRisingPost's assertNoInternalVocabulary refuses an internal word on one.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { forYouOrder, underScoreBar } from './rising.ts';

const sorted = (posts: { score: number | null; at: number; id: string }[]) => [...posts].sort(forYouOrder).map((p) => p.id);

test('the order model ranks For You, ties newest first, then by id', () => {
  assert.deepEqual(sorted([{ score: 0.2, at: 3, id: 'a' }, { score: 0.9, at: 1, id: 'b' }, { score: 0.2, at: 5, id: 'c' }]), ['b', 'c', 'a']);
  assert.deepEqual(sorted([{ score: 0.5, at: 1, id: 'b' }, { score: 0.5, at: 1, id: 'a' }]), ['a', 'b']);
});

test('★ with no fit applied every number is null and For You is newest first, as before', () => {
  assert.deepEqual(sorted([{ score: null, at: 1, id: 'a' }, { score: null, at: 9, id: 'b' }, { score: null, at: 4, id: 'c' }]), ['b', 'c', 'a']);
});

test('★ the bar holds a post back only when set, with a number, and never over the owner\'s meme call', () => {
  assert.equal(underScoreBar(0.2, null, null), false, 'no bar: the rules decide');
  assert.equal(underScoreBar(null, 0.5, null), false, 'no fit: nothing to hold by');
  assert.equal(underScoreBar(0.2, 0.5, null), true);
  assert.equal(underScoreBar(0.5, 0.5, null), false, 'at the bar is over it');
  assert.equal(underScoreBar(0.2, 0.5, 'meme'), false);
  assert.equal(underScoreBar(0.2, 0.5, 'not'), true);
});
