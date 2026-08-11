/**
 * The wide (story, asset) feature set.
 *
 * This is the vector RESOLVE's abstains are logged with, and those abstains are the
 * training set: every time the system says "unsure", it writes down exactly what it
 * saw, and a human adjudicating it later produces a label against that frozen vector.
 * That is how a venue clears its cold start — the read-only first month is not a
 * limitation, it is the data collection.
 *
 * Nothing here may be recomputed at training time. The market moves, the symbol
 * collision statistic moves, and the asset's own metadata is editable by whoever
 * issued it — so a feature recovered later is a feature about a different world.
 */

import type { FeatureVector } from '@insidor/contracts/features.ts';

import { notImplemented } from '../not-implemented.ts';
import type { ResolveCandidate } from '../resolve/gates.ts';

/** TO BUILD: the wide candidate vector over the five channels and the gate outcomes. */
export function candidateFeatures(_candidate: ResolveCandidate): FeatureVector {
  return notImplemented('features/candidate.ts: the wide candidate feature set');
}
