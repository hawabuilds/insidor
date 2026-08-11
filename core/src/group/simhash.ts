/**
 * Near-duplicate text, as a fixed-width hash plus a distance.
 *
 * Two properties this must have, both of which the previous implementation lacked:
 * it must be a hash of SHINGLES rather than of a token bag, so word order carries,
 * and it must weight terms by persistence rather than by raw document frequency, so
 * a new name is not suppressed exactly as it starts spreading.
 *
 * It must also refuse to emit for items with fewer than Policy.group.minShingles
 * shingles. A short item's hash is dominated by a handful of terms and matches
 * everything else that is short, which is a false-positive generator aimed at the
 * cheapest items to produce.
 */

import { notImplemented } from '../not-implemented.ts';

/** TO BUILD: a weighted SimHash over the item's shingles, returned as a hex string. */
export function simhash(_shingles: readonly string[], _weights: readonly number[]): string | null {
  return notImplemented('group/simhash.ts: the weighted shingle hash');
}

/** TO BUILD: Hamming distance between two same-width hex hashes. */
export function hammingHex(_a: string, _b: string): number {
  return notImplemented('group/simhash.ts: hamming distance over hex');
}
