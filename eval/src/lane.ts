/**
 * Which lane a logged decision came from, and what each lane can honestly answer.
 *
 * This is one file rather than a comment somewhere because the common failure is
 * computing an off-policy estimate across the whole log and reporting a number
 * that means nothing. The lane is not a tag; it determines which questions the
 * rows can be asked.
 */

import type { Decision } from '@insidor/contracts';

export const LANES = ['exploit', 'epsilon', 'holdout'] as const;
export type Lane = (typeof LANES)[number];

/**
 *   exploit  — propensity 1.0. Estimates nothing counterfactual. On-policy only.
 *   epsilon  — propensity strictly between 0 and 1. Valid over the ELIGIBLE POOL,
 *              and only with a self-normalised estimator: plain IPS has unbounded
 *              variance when a propensity is small, and 2 picks from a pool of
 *              200 gives weights of 100.
 *   holdout  — uniform over ARRIVALS, bypassing every gate, tracked and matched
 *              but never rendered. ★ The only lane that can answer "what would a
 *              5,000-view floor have caught?" — the exploit lane cannot answer it
 *              at any sample size, because it never saw what the gate rejected.
 */
export function laneOf(d: Decision): Lane {
  if (d.exploreArm === 'holdout') return 'holdout';
  if (d.explore) return 'epsilon';
  return 'exploit';
}

/**
 * Can a replay over these rows support a claim about the whole arrival stream?
 *
 * Only the holdout lane can. Replaying the exploit lane and reporting "the new
 * threshold catches 14% more" is a claim about items the old gate already let
 * through, which is not the question anyone was asking — and it is the exact
 * shape of the selection artefact that voided the previous backtest, where the
 * population was graduated coins and the claim was about coinability at large.
 */
export function supportsArrivalStreamClaim(lanes: readonly Lane[]): boolean {
  return lanes.length === 1 && lanes[0] === 'holdout';
}

/** The sentence a report prints under any number computed over these lanes. */
export function populationCaveat(lanes: readonly Lane[]): string {
  if (supportsArrivalStreamClaim(lanes)) {
    return 'Holdout lane only: uniform over arrivals, bypassing every gate. Valid for unbiased ' +
      'replay of any candidate policy over the whole arrival stream.';
  }
  if (lanes.includes('holdout')) {
    return 'MIXED LANES. Numbers below pool gated and ungated rows and describe no single ' +
      'population. Split by lane before reading them.';
  }
  if (lanes.length === 1 && lanes[0] === 'epsilon') {
    return 'Epsilon lane only: valid over the eligible-but-below-cut pool, with a self-normalised ' +
      'estimator. Says nothing about items the gate rejected outright.';
  }
  return 'Exploit lane: on-policy only. These rows are what the live gate already admitted, so ' +
    'they cannot measure what a different gate would have caught.';
}
