/**
 * DETECT — is this accelerating relative to its own baseline?
 *
 * This stage costs nothing and produces the earliest alert the system can make: it
 * reads only numbers we already paid for. Which is why its rules are the ones most
 * worth getting right, and why every one of them is a ratio rather than a level.
 *
 * Three things it must do, all of them repairs of measured failures:
 *   - Never fire on a self-baseline alone. The account's own history is under an
 *     adversary's control; the relative test lives INSIDE a hard absolute floor.
 *   - Never treat a censored reading as a zero. It arrives as a Rate, so the
 *     compiler enforces this — D2_rate_censored is the honest answer, and it is a
 *     different row from D5_no_acceleration.
 *   - Use the continuous-time averages, not the discrete recurrence, because the
 *     read grid is irregular by design.
 */

import type { Decision, StageContext } from '@insidor/contracts/decision.ts';
import type { FeatureSetId, FeatureVector } from '@insidor/contracts/features.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { Item, Observation } from '@insidor/contracts/vocabulary.ts';

import type { Ewma } from '../kinetics/ewma.ts';
import { notImplemented } from '../not-implemented.ts';
import type { Baseline } from './baseline.ts';

export const NAME = 'detect' as const;
export const FEATURE_SET: FeatureSetId = 'item.detect.v1';
export const DECIDER = 'rule:detect@1';

export interface DetectInput {
  readonly item: Item;
  /** Newest last. Each carries its own Rate, censored or measured. */
  readonly observations: readonly Observation[];
  readonly fast: Ewma | null;
  readonly slow: Ewma | null;
  readonly self: Baseline | null;
  readonly population: Baseline | null;
  readonly costUsd: number;
}

/**
 * TO BUILD: burst from the two averages, eta against both baselines, then the gates
 * in Policy.detect — absolute floor first, because it is the one an adversary cannot
 * open. Verdicts: 'pass' on D0_burst, 'drop' on D5_no_acceleration,
 * 'abstain' on D1_insufficient_history and D2_rate_censored.
 */
export function detect(_input: DetectInput, _p: Policy, _ctx: StageContext): Decision {
  return notImplemented('detect/stage.ts: the burst decision');
}

export function extract(_input: DetectInput, _ctx: StageContext): FeatureVector {
  return notImplemented('detect/stage.ts: the detect feature vector');
}
