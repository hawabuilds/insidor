/**
 * The edge swipe's decision (edge-back.ts): only from the edge, a scroll is never taken for a swipe,
 * and only a swipe far enough or fast enough goes back.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COMMIT_PX, decidedBy, goesBack, phaseOf, startsSwipe } from './edge-back.ts';

test('a swipe starts only at the left edge', () => {
  assert.equal(startsSwipe(0), true);
  assert.equal(startsSwipe(20), true);
  assert.equal(startsSwipe(40), false);
  assert.equal(startsSwipe(200), false);
});

test('★ a scroll that starts near the edge is dropped, never taken for back', () => {
  assert.equal(phaseOf(4, 30, false), 'dropped');
  assert.equal(phaseOf(10, -40, false), 'dropped');
  assert.equal(phaseOf(5, 5, false), 'tracking');
});

test('once it is a sideways swipe, drifting up or down does not drop it; going back left does', () => {
  assert.equal(decidedBy(14, 4), true);
  assert.equal(decidedBy(10, 20), false);
  assert.equal(phaseOf(60, 50, true), 'tracking');
  assert.equal(phaseOf(-20, 0, true), 'dropped');
});

test('★ letting go goes back only when far enough, or a quick flick', () => {
  assert.equal(goesBack(COMMIT_PX, 900), true);
  assert.equal(goesBack(60, 900), false);
  assert.equal(goesBack(50, 80), true);
  assert.equal(goesBack(30, 20), false);
  assert.equal(goesBack(50, 0), false);
});
