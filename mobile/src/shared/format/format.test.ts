import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatAge } from './duration.ts';
import { instantFrom, known, pending } from './measure.ts';
import { compact, formatChangePercent, formatCount, formatPrice, formatUsd } from './number.ts';

test('counts read the way the designs write them', () => {
  assert.equal(compact(41_200), '41K');
  assert.equal(compact(681_000), '681K');
  assert.equal(compact(2_440_000), '2.4M');
  assert.equal(compact(1_000_000), '1M');
  assert.equal(compact(999), '999');
  assert.equal(formatUsd(known(4_310)).text, '$4.3K');
  assert.equal(formatUsd(known(84_200)).text, '$84K');
  assert.equal(formatUsd(known(1_240_000)).text, '$1.24M', 'a cap in the millions keeps two decimals');
  assert.equal(formatUsd(known(1_200_000)).text, '$1.2M');
  assert.equal(formatUsd(known(9_996_000)).text, '$10M');
  assert.equal(formatUsd(known(950_000_000)).text, '$950M');
  assert.equal(formatUsd(known(0.000035)).text, '<$0.01', 'a real amount under a cent is never $0');
});

test('rounding never produces a four-digit figure in the smaller unit', () => {
  assert.equal(compact(999_600), '1M');
  assert.equal(compact(999_499), '999K');
});

test('an absence is a dash with its reason, never a zero', () => {
  const r = formatCount(pending('not_reported'));
  assert.deepEqual(r, { kind: 'pending', text: '—', reason: 'not_reported' });
  assert.equal(formatAge(instantFrom(null, 'not_read_yet'), 0).text, '—');
});

test('a sub-cent price is written out, never as $0.00 and never in exponent form', () => {
  assert.equal(formatPrice(known(0.0000043)).text, '$0.0000043');
  assert.equal(formatPrice(known(0.000000041234)).text, '$0.000000041');
  assert.equal(formatPrice(known(0.5)).text, '$0.50');
  assert.equal(formatPrice(known(12.345)).text, '$12.35');
});

test('a change carries its direction separately from its digits', () => {
  assert.deepEqual(formatChangePercent(known(-7.86)), { text: { kind: 'value', text: '7.9%' }, direction: 'down' });
  assert.equal(formatChangePercent(pending('not_reported')).direction, null);
});

test('an origin in the future is unreadable, not a negative age', () => {
  assert.deepEqual(formatAge(instantFrom(2_000, 'not_read_yet'), 1_000), {
    kind: 'pending',
    text: '—',
    reason: 'unreadable',
  });
});
