/**
 * The feature hash: sha256 of the sorted feature-name list.
 *
 * WHY IT IS THE SORTED KEY LIST AND NOT THE VALUES: this identifies the SHAPE of
 * a feature vector, not an instance of one. Every decision row carries it, every
 * artefact carries it, and promotion compares them. A model trained on a vector
 * that has since gained, lost or renamed a feature must not be able to score
 * against the new one — it would read `undefined` for the missing name, take the
 * missing branch on every row, and produce confident nonsense.
 *
 * Sorted, so key order in a JSON blob cannot change the hash. Newline-joined
 * with the count prefixed, so `["ab","c"]` and `["a","bc"]` cannot collide.
 */

import { createHash } from 'node:crypto';
import type { FeatureVector } from '@insidor/contracts/features.ts';

export function hashFeatureNames(names: readonly string[]): string {
  const sorted = [...names].sort();
  const payload = `${sorted.length}\n${sorted.join('\n')}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/** The hash of a vector's shape, for the decision-log row that recorded it. */
export function hashFeatureVector(f: FeatureVector): string {
  return hashFeatureNames(Object.keys(f));
}

/** sha256 of an artefact's bytes, as stored in the registry row. */
export function hashArtefactBytes(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * sha256 of the model and the calibrator — NOT of the sidecar.
 *
 * The sidecar contains this hash, so hashing it would be self-referential. What
 * the promotion gate is asking is "are these the bytes that were trained", and
 * these are those bytes. `ml/train/export.py` computes the same digest over the
 * same canonical form: keys sorted at every level, no whitespace.
 */
export function hashArtefactBody(model: unknown, calibration: unknown): string {
  return hashArtefactBytes(canonicalJson({ calibration, model }));
}

/** Deterministic JSON: keys sorted at every depth, no whitespace, no cycles. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const o = value as Record<string, unknown>;
  const parts = Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`);
  return `{${parts.join(',')}}`;
}
