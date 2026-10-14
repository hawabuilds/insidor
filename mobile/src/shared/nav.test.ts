/** Back from the home-screen app: history only when an entry of ours is under this one, else the screen's parent. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { backStep, entryState } from './nav.ts';

test('★ the entry the app opened on has nothing of ours under it: Back goes to the parent', () => {
  assert.equal(backStep(0), 'fallback');
  /* An entry we never numbered (opened before this code, or by a link) is treated the same. */
  assert.equal(backStep(null), 'fallback');
});

test('an entry past the first goes back through history, to where they came from', () => {
  assert.equal(backStep(1), 'history');
  assert.equal(backStep(7), 'history');
});

test('a hand-pushed entry carries its number', () => {
  assert.deepEqual(entryState(2), { insidorAt: 2 });
});
