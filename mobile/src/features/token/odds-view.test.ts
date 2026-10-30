/**
 * The similar-launches card's numbers and colours: a share never reads "0%" when some did, an unsent share
 * or time is a dash, a median time reads short, and only a clear difference from usual gets a colour.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { better, peakText, sharePercent } from './odds-view.ts';

test('a share is a whole percentage, one decimal under one percent, and an unsent share is a dash', () => {
  assert.equal(sharePercent(0.31), '31%');
  assert.equal(sharePercent(0.008), '0.8%');
  assert.equal(sharePercent(0.0004), '<0.1%');
  assert.equal(sharePercent(0), '0%');
  assert.equal(sharePercent(null), '—');
});

test('a median time reads short', () => {
  assert.equal(peakText(40), '40s');
  assert.equal(peakText(250), '4m');
  assert.equal(peakText(6_720), '1h 52m');
  assert.equal(peakText(null), '—');
});

test('only a clear difference from usual is coloured, the right way round', () => {
  assert.equal(better(0.24, 0.06, true), 'good');
  assert.equal(better(0.04, 0.12, true), 'bad');
  assert.equal(better(0.52, 0.58, false), '');
  assert.equal(better(0.31, 0.74, false), 'good');
  assert.equal(better(0.91, 0.5, false), 'bad');
  assert.equal(better(null, 0.5, true), '');
});
