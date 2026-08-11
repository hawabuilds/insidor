/**
 * What we expected, which is the whole difficulty. Two baselines, and neither may be
 * used alone.
 *
 *   SELF       — the subject's own trailing behaviour. Sensitive, early, and under
 *                the adversary's control in BOTH directions: depress it with filler,
 *                then buy engagement on the target. A gate an attacker can open by
 *                buying a hundred approvals is worse than no gate, so the self
 *                baseline is a re-ranker inside a hard absolute floor, never a
 *                standalone trigger.
 *   POPULATION — the median for the cohort at this hour of the day. Robust, slower,
 *                and blind to a subject that is unusual for itself but ordinary for
 *                everyone.
 */

import type { CounterKind, Millis } from '@insidor/contracts/vocabulary.ts';

import { notImplemented } from '../not-implemented.ts';

export interface Baseline {
  readonly expectation: number;
  readonly dispersion: number;
  /** How many readings it was fitted on. Below Policy.detect.minBaselineReads it is unusable. */
  readonly reads: number;
}

/** TO BUILD: a negative-binomial fit over the subject's own trailing readings. */
export function selfBaseline(
  _rates: readonly number[],
  _kind: CounterKind,
): Baseline {
  return notImplemented('detect/baseline.ts: the trailing self baseline');
}

/**
 * TO BUILD: the cohort baseline, keyed by (source, hour of day). The key is built by
 * the adapter's baselineKey() so that the cohort definition belongs to whoever knows
 * what the source's numbers mean — this file only consumes the fitted result.
 */
export function populationBaseline(
  _cohortRates: readonly number[],
  _at: Millis,
): Baseline {
  return notImplemented('detect/baseline.ts: the cohort baseline by source and hour');
}
