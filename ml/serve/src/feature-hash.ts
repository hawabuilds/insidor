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

/**
 * ★ SORTED BY CODE POINT, NOT BY UTF-16 CODE UNIT, AND THE DIFFERENCE IS REAL.
 *
 * JavaScript's `Array.prototype.sort()` with no comparator compares strings by
 * UTF-16 code unit. Python's `sorted()` compares by code point. For every
 * character in the Basic Multilingual Plane the two orders are identical — which
 * is why this was invisible for the whole life of the file — but an astral
 * character (U+10000 and above) is stored as a surrogate pair beginning at
 * U+D800..U+DBFF, so UTF-16 sorts it BELOW everything in U+E000..U+FFFF while its
 * code point is far above them.
 *
 * The consequence is not cosmetic. `ml/train/build_dataset.py` computes this same
 * digest in Python and writes it into the artefact sidecar; `parseMetadata`
 * recomputes it here and refuses any artefact whose two halves disagree. One
 * feature name outside the BMP and every model Python produces becomes unloadable
 * — or, if the two hashes were compared somewhere less strict, champion and
 * challenger would be compared across two different alphabets while looking fine.
 *
 * Measured, not assumed: `ml/serve/fixtures/walker-parity.json` carries a case
 * whose names are `["a", "�", "\u{1D51E}"]`, where the two orders differ,
 * with Python's digest beside it. It failed against the default sort.
 */
function byCodePoint(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i++) {
    const x = left[i]?.codePointAt(0) ?? 0;
    const y = right[i]?.codePointAt(0) ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return left.length - right.length;
}

export function hashFeatureNames(names: readonly string[]): string {
  const sorted = [...names].sort(byCodePoint);
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
