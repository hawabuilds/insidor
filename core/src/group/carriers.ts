/**
 * Carriers — the free tier of grouping, and the tier that does most of the work.
 *
 * A carrier is something two items can share exactly: a perceptual image hash, a
 * near-duplicate text hash, a format id, an explicit lineage pointer. Matching on one
 * costs no API call, no model and no language — the same image posted on two
 * different platforms in two different languages produces the same bits. That is what
 * makes the grouper multilingual and cross-source BEFORE any model exists, and it is
 * why this tier ships first and alone.
 *
 * The tier below it, learned representations, must never become a precondition for
 * joining. If it does, a representation outage stops grouping instead of degrading it,
 * and nobody will have decided to accept that.
 */

import type { Fingerprint } from '@insidor/contracts/vocabulary.ts';
import type { Policy } from '@insidor/contracts/policy.ts';

import { notImplemented } from '../not-implemented.ts';

export interface CarrierMatch {
  readonly carrier: Fingerprint;
  /** Hamming-style distance for hash carriers; null for exact-match kinds. */
  readonly distance: number | null;
  /** From persistence.ts. A carrier everyone shares is not evidence. */
  readonly weight: number;
}

/**
 * TO BUILD: intersect an item's fingerprints against a story's carriers, applying the
 * per-kind distance bars in Policy.group and the persistence weighting.
 *
 * A note that will otherwise be rediscovered expensively: the distance bars are
 * per-kind and per-bit-width, and a bar calibrated for one hash size is meaningless
 * for another. They live in Policy keyed by kind for that reason.
 */
export function carrierMatches(
  _itemFingerprints: readonly Fingerprint[],
  _storyCarriers: readonly Fingerprint[],
  _p: Policy,
): readonly CarrierMatch[] {
  return notImplemented('group/carriers.ts: the free carrier join');
}
