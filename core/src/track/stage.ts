/**
 * TRACK — when do we look at this item again?
 *
 * This is a spending decision wearing a scheduling costume: every read costs money
 * at a vendor, and the shape of the read schedule is what determines whether the
 * kinetics have anything to work with. It is stubbed, not designed away — the rules
 * it must implement are written out in schedule.ts and shed.ts, and the lane
 * assignment it shares with ADMIT is already implemented in holdout.ts.
 *
 * WHAT MUST NOT CHANGE WHEN IT IS BUILT: an item's history length may not depend on
 * its early performance. That is the outcome, and conditioning the record on it
 * poisons every model trained on the record afterwards.
 */

import type { Decision, StageContext } from '@insidor/contracts/decision.ts';
import type { FeatureSetId, FeatureVector } from '@insidor/contracts/features.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { Item, Millis, Observation } from '@insidor/contracts/vocabulary.ts';

import { notImplemented } from '../not-implemented.ts';

export const NAME = 'track' as const;
export const FEATURE_SET: FeatureSetId = 'item.track.v1';
export const DECIDER = 'rule:track@1';

export interface TrackInput {
  readonly item: Item;
  /** The readings so far, newest last. Rates carry their own censoring. */
  readonly observations: readonly Observation[];
  readonly lastReadAt: Millis;
  readonly tier: number;
  /** The item's last decided score, which selects the tier. null before the first. */
  readonly lastScore: number | null;
  /** Consecutive readings that produced no usable rate. Drives lifecycle demotion. */
  readonly censoredReadStreak: number;
  /** From the lane assignment made at admission. Never recomputed here. */
  readonly isHeldBack: boolean;
  /** Reads left in this interval's budget, as a number. Nothing is queried here. */
  readonly readsAvailable: number;
  readonly costUsd: number;
}

/**
 * TO BUILD: the tier, the due time, and the shed decision, in that order.
 * Verdicts: 'pass' when a read is due and affordable (T0_scheduled), 'hold' when it
 * is not yet due (T6_not_due), 'drop' when the lifecycle is terminal (T3_terminal).
 * A held-back item is T5_holdout_full_grid and never consults the budget.
 */
export function track(_input: TrackInput, _p: Policy, _ctx: StageContext): Decision {
  return notImplemented('track/stage.ts: the re-read decision');
}

export function extract(_input: TrackInput, _ctx: StageContext): FeatureVector {
  return notImplemented('track/stage.ts: the track feature vector');
}
