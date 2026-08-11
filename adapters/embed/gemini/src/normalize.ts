/**
 * Vector hygiene, kept here rather than in the store or the grouper.
 *
 * Cosine similarity over unit vectors is a dot product, and the index is
 * configured for that. A vector that arrives un-normalised produces
 * similarities that look plausible and rank wrong — the worst failure shape
 * this system has. So normalisation happens once, at the edge, and the
 * dimension is checked against what the port declared rather than trusted.
 */

import { VendorShapeError } from '@insidor/vendor-kit';

export function l2Normalize(vector: Float32Array): Float32Array {
  let sumSquares = 0;
  for (const v of vector) sumSquares += v * v;
  if (sumSquares === 0) throw new VendorShapeError('embed', 'vector', 'is all zeros and cannot be normalised');
  const norm = Math.sqrt(sumSquares);
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = (vector[i] ?? 0) / norm;
  return out;
}

export function assertDimension(vector: Float32Array, expected: number): void {
  if (vector.length !== expected) {
    throw new VendorShapeError('embed', 'vector', `has ${vector.length} dimensions, expected ${expected}`);
  }
  for (const v of vector) {
    if (!Number.isFinite(v)) throw new VendorShapeError('embed', 'vector', 'contains a non-finite value');
  }
}
