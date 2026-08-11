/**
 * Hysteresis on an item's lifecycle state.
 *
 * WHY a state machine with hysteresis rather than a threshold on the current
 * reading: every state here has a cost attached — `rising` buys reads at the top
 * tier, `dormant` stops spending — and a state derived from one noisy reading
 * oscillates, which means the scheduler spends its budget flapping. A transition
 * therefore needs BOTH a margin over the bar and a number of consecutive readings
 * that agree, and the two bars are asymmetric: entering `rising` is cheap to get
 * wrong, leaving it is not.
 *
 * NOT AN ENUM: type stripping cannot erase one, so it would fail at module load
 * rather than in the editor. A frozen object plus a union of its values is the
 * shape every closed set in this repository takes.
 */

import type { Millis } from '@insidor/contracts/vocabulary.ts';

import { notImplemented } from '../not-implemented.ts';

export const LIFECYCLE_STATES = ['fresh', 'rising', 'steady', 'cooling', 'dormant'] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export interface LifecycleReading {
  readonly state: LifecycleState;
  /** How many consecutive readings have agreed with the proposed state. */
  readonly agreeing: number;
  readonly since: Millis;
}

/**
 * TO BUILD: the transition table.
 *
 * Takes the current state, the state this reading argues for, and the margin by
 * which it argues for it; returns the state to record. Every bar it consults —
 * the margin, the agreement count per edge, the minimum dwell — comes from
 * Policy.track, because a lifecycle bar is a spend decision.
 *
 * Terminal edges matter most: `dormant` stops tracking, so entering it wrongly
 * costs an item permanently, and the record of it is a T3_terminal decision.
 */
export function nextLifecycle(
  _current: LifecycleReading,
  _proposed: LifecycleState,
  _margin: number,
  _now: Millis,
): LifecycleReading {
  return notImplemented('kinetics/lifecycle.ts: the lifecycle transition table');
}
