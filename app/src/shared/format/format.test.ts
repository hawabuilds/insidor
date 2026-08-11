/**
 * The missing-data rules, asserted.
 *
 * These are not unit tests of arithmetic. They are the executable statement of the property
 * the whole directory exists for: an absent number cannot come out of a formatter as a
 * number. If someone later adds a convenience overload taking `number | null`, one of these
 * fails.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { PendingReason } from './measure.ts';
import { known, measuredFrom, pending, pendingInstant, instant } from './measure.ts';
import { formatCount, formatUsd, formatPrice, formatDelta } from './number.ts';
import { formatAge } from './duration.ts';
import { PENDING_GLYPH } from './rendered.ts';

const ALL_REASONS: readonly PendingReason[] = [
  'not_minted',
  'no_market',
  'not_read_yet',
  'not_reported',
  'unreadable',
];

test('no formatter renders an absent number as a number, for any reason', () => {
  const formatters = [formatCount, formatUsd, formatPrice, formatDelta];
  for (const reason of ALL_REASONS) {
    for (const format of formatters) {
      const out = format(pending(reason));
      assert.equal(out.kind, 'pending');
      assert.equal(out.text, PENDING_GLYPH);
      assert.ok(!/\d/.test(out.text), `${format.name} emitted a digit for ${reason}`);
    }
  }
});

test('null from the wire becomes pending, never zero', () => {
  const m = measuredFrom(null, 'no_market');
  assert.equal(m.known, false);
  const out = formatUsd(m);
  assert.equal(out.kind, 'pending');
  assert.notEqual(out.text, '$0');
});

test('a real zero is still a zero — absence and zero stay distinct', () => {
  const out = formatCount(known(0));
  assert.equal(out.kind, 'value');
  assert.equal(out.text, '0');
});

test('an unknown origin does not render as a brand-new age', () => {
  /* The exact regression: a missing timestamp used to render as age 0, i.e. the freshest
     possible row, on a product that ranks by earliness. */
  const out = formatAge(pendingInstant('not_read_yet'), 1_700_000_000_000);
  assert.equal(out.kind, 'pending');
  assert.equal(out.text, PENDING_GLYPH);
  assert.notEqual(out.text, '0s');
});

test('a known origin renders one unit', () => {
  const now = 1_700_000_000_000;
  assert.deepEqual(formatAge(instant(now - 90_000), now), { kind: 'value', text: '1m' });
  assert.deepEqual(formatAge(instant(now - 6 * 86_400_000), now), { kind: 'value', text: '6d' });
});

test('an origin in the future is unreadable, not a negative age', () => {
  const now = 1_700_000_000_000;
  const out = formatAge(instant(now + 60_000), now);
  assert.equal(out.kind, 'pending');
});

test('a sub-cent price never collapses to $0.00', () => {
  const out = formatPrice(known(0.0000000412));
  assert.equal(out.kind, 'value');
  assert.notEqual(out.text, '$0.00');
  assert.ok(out.text.includes('4.12'));
});

test('a non-finite number is not a number we have', () => {
  assert.equal(known(Number.NaN).known, false);
  assert.equal(known(Number.POSITIVE_INFINITY).known, false);
});
