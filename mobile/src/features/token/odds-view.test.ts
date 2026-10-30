/**
 * A share on the launch history block: a whole percentage, "<1%" for a sliver (never "0%"), a dash when unsent.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sharePercent } from './odds-view.ts';

test('a share is a whole percentage, a sliver is under one percent, an unsent share is a dash', () => {
  assert.equal(sharePercent(0.31), '31%');
  assert.equal(sharePercent(0.004), '<1%');
  assert.equal(sharePercent(0), '0%');
  assert.equal(sharePercent(null), '—');
});
