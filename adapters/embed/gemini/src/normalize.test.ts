/**
 * The three properties `normalize.ts` exists to hold, asserted at the last point
 * where they are still observable.
 *
 * WHY THIS MODULE IS WORTH ITS OWN TESTS. Every failure in it is SILENT
 * downstream. The index accepts any float array; cosine-as-a-dot-product returns
 * a plausible-looking number for a vector of the wrong length, the wrong scale or
 * no direction at all; and the grouper cannot tell a wrong ordering from a right
 * one — it simply stops joining posts that belong together. There is no exception
 * to catch and no obviously bad value to spot in a log. After the write, the only
 * symptom is stories that quietly never form.
 *
 * ★ THE ALL-ZERO CASE IS THE ONE TO DEFEND WHEN IT LOOKS PEDANTIC. A zero vector
 * has no direction, and both of the tempting ways to "handle" it — divide anyway
 * and emit NaN, or return the input untouched — hand the index something every
 * comparison scores identically. Throwing is the only answer that does not invent
 * an embedding out of nothing. If this assertion is ever softened into a
 * fallback, the adapter has started fabricating data, and the fabrication ranks.
 *
 * The dimension test also covers non-finite components, for the same reason it
 * covers length: both cost nothing to check here and are undetectable afterwards.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { VendorShapeError } from '@insidor/vendor-kit';

import { assertDimension, l2Normalize } from './normalize.ts';

const magnitude = (v: Float32Array): number => Math.sqrt([...v].reduce((s, x) => s + x * x, 0));

test('a normalised vector has unit length, so cosine is a dot product', () => {
  const v = l2Normalize(new Float32Array([3, 4]));
  assert.ok(Math.abs(magnitude(v) - 1) < 1e-6);
  assert.ok(Math.abs((v[0] ?? 0) - 0.6) < 1e-6);
  assert.ok(Math.abs((v[1] ?? 0) - 0.8) < 1e-6);
});

test('an all-zero vector is a shape error, not a silently unit vector', () => {
  assert.throws(() => l2Normalize(new Float32Array([0, 0, 0])), VendorShapeError);
});

test('a wrong dimension is caught at the edge, not in the index', () => {
  assert.throws(() => assertDimension(new Float32Array([1, 2]), 3), VendorShapeError);
  assert.throws(() => assertDimension(new Float32Array([1, Number.NaN, 3]), 3), VendorShapeError);
  assertDimension(new Float32Array([1, 2, 3]), 3);
});
