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
