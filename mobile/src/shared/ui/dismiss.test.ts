/** Back closes this page's layers deeper than where it lands, and steps over entries no layer owns. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { onLanding } from './dismiss.ts';

const L = (depth: number) => ({ depth, name: `l${depth}` });

test('back from a sheet onto its page closes the sheet', () => {
  const r = onLanding([L(1)], 0);
  assert.deepEqual(r.close.map((l) => l.depth), [1]);
  assert.equal(r.stepOver, 0);
});

test('only the top layer closes per step, top first when several do', () => {
  assert.deepEqual(onLanding([L(1), L(2)], 1).close.map((l) => l.depth), [2]);
  assert.deepEqual(onLanding([L(1), L(2), L(3)], 0).close.map((l) => l.depth), [3, 2, 1]);
});

test('★ back from a coin onto the post sheet it was opened from: the sheet is still open, nothing closes', () => {
  const r = onLanding([L(1)], 1);
  assert.deepEqual(r.close, []);
  assert.equal(r.stepOver, 0);
});

test('a sheet entry whose sheet is gone (closed while its page was away) is stepped over', () => {
  assert.equal(onLanding([], 1).stepOver, 1);
  assert.equal(onLanding([L(1)], 2).stepOver, 1);
});

test('a page with nothing open, landed on plainly: nothing to do', () => {
  assert.deepEqual(onLanding([], 0), { close: [], stepOver: 0 });
});
