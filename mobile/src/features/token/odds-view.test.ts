/**
 * The launch profile's numbers: a share is a whole percentage, a sliver is "<1%" (never "0%"), an unsent
 * share or time is a dash, a multiple of the average is one decimal under ten, and a median time reads short.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { peakText, sharePercent, timesText } from './odds-view.ts';

test('a share is a whole percentage, a sliver is under one percent, an unsent share is a dash', () => {
  assert.equal(sharePercent(0.31), '31%');
  assert.equal(sharePercent(0.004), '<1%');
  assert.equal(sharePercent(0), '0%');
  assert.equal(sharePercent(null), '—');
});

test('a multiple of the average, and a median time', () => {
  assert.equal(timesText(0.48, 0.12), '4.0×');
  assert.equal(timesText(0.35, 0.02), '18×');
  assert.equal(timesText(0.35, 0), '—');
  assert.equal(peakText(40), '40s');
  assert.equal(peakText(250), '4m');
  assert.equal(peakText(6_720), '1h 52m');
  assert.equal(peakText(null), '—');
});
