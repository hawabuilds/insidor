/**
 * These tests exist to pin one behaviour: absent never becomes zero.
 * Every other assertion here is scaffolding around that one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { arr, bool, dateToMillis, missing, num, rec, secondsToMillis, str } from './read.ts';

test('an absent number reads as null, never as zero', () => {
  const pair = rec({ price: '1.5' });
  assert.equal(num(pair.liquidity), null);
  assert.equal(missing(pair, 'liquidity'), true);
});

test('a present zero stays zero — a drained pool is not an absent one', () => {
  const pair = rec({ liquidity: { usd: 0 } });
  assert.equal(num(rec(pair.liquidity).usd), 0);
  assert.equal(missing(pair, 'liquidity'), false);
});

test('numeric strings parse; empty and non-numeric strings do not', () => {
  assert.equal(num('1200'), 1200);
  assert.equal(num(''), null);
  assert.equal(num('   '), null);
  assert.equal(num('n/a'), null);
  assert.equal(num(Number.NaN), null);
  assert.equal(num(Number.POSITIVE_INFINITY), null);
});

test('empty strings are absent, because vendors use them where they mean null', () => {
  assert.equal(str(''), null);
  assert.equal(str('x'), 'x');
  assert.equal(str(7), null);
});

test('rec and arr make a hostile payload safe to walk', () => {
  assert.deepEqual(rec(null), {});
  assert.deepEqual(rec([1, 2]), {}); // an array is not a record
  assert.deepEqual(arr('nope'), []);
  assert.equal(bool('true'), true);
  assert.equal(bool('yes'), null);
});

test('seconds become millis and null stays null', () => {
  assert.equal(secondsToMillis(1_700_000_000), 1_700_000_000_000);
  assert.equal(secondsToMillis(null), null);
  assert.equal(secondsToMillis('nope'), null);
});

test('date strings parse to millis without reading a clock', () => {
  assert.equal(dateToMillis('2026-01-01T00:00:00.000Z'), Date.UTC(2026, 0, 1));
  assert.equal(dateToMillis('not a date'), null);
  assert.equal(dateToMillis(undefined), null);
});
