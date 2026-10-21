/** How a card's picture moves along its sources (picture-tries.ts). */

import test from 'node:test';
import assert from 'node:assert/strict';

import { afterFailure, freshTries, nextRound, pictureNow, retryOwed } from './picture-tries.ts';

const sources = ['https://a/sized', 'https://a/original'];

test('a failed source hands over to the next at once', () => {
  let t = freshTries(sources);
  assert.equal(pictureNow(sources, t), 'https://a/sized');
  t = afterFailure(t, 'https://a/sized');
  assert.equal(pictureNow(sources, t), 'https://a/original');
  assert.equal(retryOwed(sources, t), false);
});

test('every source failed: the placeholder, then one more round, then the placeholder for good', () => {
  let t = freshTries(sources);
  for (const s of sources) t = afterFailure(t, s);
  assert.equal(pictureNow(sources, t), null);
  assert.equal(retryOwed(sources, t), true);
  t = nextRound(t);
  assert.equal(pictureNow(sources, t), 'https://a/sized');
  for (const s of sources) t = afterFailure(t, s);
  assert.equal(pictureNow(sources, t), null);
  assert.equal(retryOwed(sources, t), false);
});

test('no sources: the placeholder and nothing owed', () => {
  const t = freshTries([]);
  assert.equal(pictureNow([], t), null);
  assert.equal(retryOwed([], t), false);
});

test('the same failure twice counts once', () => {
  const t = afterFailure(afterFailure(freshTries(sources), 'https://a/sized'), 'https://a/sized');
  assert.deepEqual(t.failed, ['https://a/sized']);
});
