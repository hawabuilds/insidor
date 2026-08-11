/**
 * RANK — what goes on the board, in what order.
 *
 * RANK IS THE LAST STAGE TO BECOME A MODEL, NOT THE FIRST. It needs board
 * impressions and clicks, which do not exist yet and will not for months. A small
 * team that gets this ordering wrong spends a quarter training the model that
 * matters least.
 *
 * Before any of it is built, run the plain age-decayed control from a public news
 * ranker against the existing snapshot series, scored on early detection. If the
 * control wins, "the old formula with hotter constants" was the right answer and one
 * cheap experiment saved a month. That is a real possibility, not a formality.
 */

import type { Decision, StageContext } from '@insidor/contracts/decision.ts';
import type { FeatureSetId, FeatureVector } from '@insidor/contracts/features.ts';
import type { Policy } from '@insidor/contracts/policy.ts';

import { notImplemented } from '../not-implemented.ts';
import type { HeatInputs } from './heat.ts';

export const NAME = 'rank' as const;
export const FEATURE_SET: FeatureSetId = 'subject.rank.v1';
export const DECIDER = 'rule:rank@1';

export interface RankInput {
  readonly subjectId: string;
  readonly subjectKind: 'story' | 'candidate';
  readonly heat: HeatInputs;
  /** The committed board this subject is being scored against, for the dwell rules. */
  readonly incumbentScore: number | null;
  readonly incumbentSince: number | null;
  readonly slot: number | null;
  readonly costUsd: number;
}

/**
 * TO BUILD: heat, then the hysteresis rules, then the slot. Verdicts: 'pass' on
 * R0_ranked, 'drop' on R1_below_cut, 'hold' on R2_dwell_hold and R3_hysteresis_hold.
 * The exploration slots (R6_explore_slot) draw from below the cut with the propensity
 * recorded — that is what the ten percent of slots buys, and it costs feed quality,
 * which is a written commitment with a number attached rather than a principle.
 */
export function rank(_input: RankInput, _p: Policy, _ctx: StageContext): Decision {
  return notImplemented('rank/stage.ts: the board decision');
}

export function extract(_input: RankInput, _ctx: StageContext): FeatureVector {
  return notImplemented('rank/stage.ts: the rank feature vector');
}
