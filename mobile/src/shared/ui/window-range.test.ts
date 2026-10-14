/** The long list's arithmetic (window-range.ts): offsets, which rows are drawn, and the hold. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { anchorShift, rowAt, rowOffsets, rowsNear } from './window-range.ts';

test('a row not yet measured counts as the average of those that are', () => {
  const offsets = rowOffsets(['a', 'b', 'c'], new Map([['a', 100], ['b', 300]]), 50);
  assert.deepEqual(offsets, [0, 100, 400, 600]);
  assert.deepEqual(rowOffsets(['a', 'b'], new Map(), 50), [0, 50, 100], 'the guess before any is measured');
});

test('the rows drawn are the ones within the margin of the screen', () => {
  const offsets = rowOffsets(Array.from({ length: 100 }, (_, i) => i), new Map(), 200);
  assert.equal(rowAt(offsets, 0), 0);
  assert.equal(rowAt(offsets, 199), 0);
  assert.equal(rowAt(offsets, 200), 1);
  assert.equal(rowAt(offsets, 1e9), 99, 'past the end is the last row');
  assert.deepEqual(rowsNear(offsets, 2000, 800, 400), { start: 8, end: 17 });
  assert.deepEqual(rowsNear(offsets, -300, 800, 0), { start: 0, end: 3 }, 'a list still below the top draws its first rows');
  assert.deepEqual(rowsNear([0], 0, 800, 400), { start: 0, end: 0 });
});

test('a post arriving above the row on screen moves the page by its height, found by key', () => {
  const before = rowOffsets(['a', 'b', 'c'], new Map([['a', 100], ['b', 100], ['c', 100]]), 100);
  const after = rowOffsets(['new', 'a', 'b', 'c'], new Map([['new', 150], ['a', 100], ['b', 100], ['c', 100]]), 100);
  assert.equal(anchorShift('b', before[1] ?? 0, ['new', 'a', 'b', 'c'], after), 150);
  assert.equal(anchorShift('gone', 0, ['a'], [0, 100]), 0);
});
