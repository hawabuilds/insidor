/**
 * The bundle rule on GTA6's real top holders (9 Nov 2026) and on a spread of different amounts.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { bundledHolders } from './bundle.ts';

test('★ GTA6: nineteen of twenty holders at exactly 301,080 tokens is one holder', () => {
  const gta6 = ['16019181', ...Array.from({ length: 19 }, () => '301080')];
  assert.equal(bundledHolders(gta6, 5), true);
});

test('different amounts, a few coincidences, and emptied accounts are not a bundle', () => {
  assert.equal(bundledHolders(['9000000', '4400000', '3100000', '3100000', '2500000', '1000000', '1000000', '1000000', '0', '0', '0', '0', '0'], 5), false);
  assert.equal(bundledHolders(['0', '0', '0', '0', '0', '0'], 5), false, 'sold-out accounts hold nothing');
  assert.equal(bundledHolders(['00500', '500', '500', '500', '500'], 5), true, 'one amount however written');
  assert.equal(bundledHolders([], 5), false);
});
