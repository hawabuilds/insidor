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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ TWO SIGNATURE DEFECTS WERE FIXED TO BUILD THIS, AND BOTH ARE WORTH RECORDING
 * because both were the kind that make a file unimplementable rather than awkward.
 *
 * 1. `nextLifecycle` had no `p: Policy`, while this header states that "every bar it
 *    consults — the margin, the agreement count per edge, the minimum dwell — comes
 *    from Policy.track". A function with no policy argument consults no policy, so
 *    every one of those bars would have been a numeric literal in this file, which
 *    `tools/check-policy.mjs` fails CI on — correctly, because a lifecycle bar decides
 *    whether we keep paying to read an item and that is a spend decision.
 *
 * 2. `LifecycleReading.agreeing` is documented as "how many consecutive readings have
 *    agreed with the PROPOSED state", and there was no field holding a proposed state.
 *    The counter had nothing to count against: on any reading that disagreed with the
 *    committed state, the previous count was about a different question. `proposed` is
 *    the missing field. With it, the existing doc on `agreeing` is exactly true; a
 *    reading where `proposed === state` is the resting position and means nothing is
 *    pending.
 *
 * ★ AND ONE PROPERTY THAT IS NOT OBVIOUS: A PROPOSAL IS RECORDED EVEN WHEN IT IS
 * REFUSED. A reading that argues for `cooling` with too little margin still advances
 * the agreement count. That is what makes the machine able to accumulate weak evidence
 * into a transition without ever acting on any single weak reading — and it is why the
 * dwell is a separate bar from the count, since otherwise a burst of readings inside
 * one minute could satisfy an agreement count without spanning enough time to have
 * observed anything at all.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import type { Millis } from '@insidor/contracts/vocabulary.ts';

export const LIFECYCLE_STATES = ['fresh', 'rising', 'steady', 'cooling', 'dormant'] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/**
 * The heat order, coldest first. It is a SEPARATE list from LIFECYCLE_STATES, which is
 * declaration order, because "is this transition a rise or a fall" is a question about
 * temperature and answering it from declaration order would make the asymmetric bars
 * depend on how somebody happened to type the union.
 *
 * `fresh` sits in the middle: a newly-seen item is not rising and not cooling, it is
 * unmeasured. So fresh → steady is a rise by a hair and fresh → cooling is a fall,
 * which is the right relative cost on both.
 */
const HEAT_ORDER: readonly LifecycleState[] = ['dormant', 'cooling', 'fresh', 'steady', 'rising'];

export interface LifecycleReading {
  /** The committed state. What the scheduler and the spend decisions actually read. */
  readonly state: LifecycleState;
  /**
   * The state recent readings have been arguing for. Equal to `state` when nothing is
   * pending, which is the resting position.
   */
  readonly proposed: LifecycleState;
  /** How many consecutive readings have agreed with the proposed state. */
  readonly agreeing: number;
  /** When the COMMITTED state was entered. The dwell is measured from here. */
  readonly since: Millis;
}

/** The state an item starts in, before any reading has argued for anything. */
export function initialLifecycle(at: Millis): LifecycleReading {
  return { state: 'fresh', proposed: 'fresh', agreeing: 0, since: at };
}

/** True for the one state that stops tracking. TRACK turns this into T3_terminal. */
export function isTerminal(state: LifecycleState): boolean {
  return state === 'dormant';
}

/**
 * The transition table.
 *
 * Takes the current state, the state this reading argues for, and the margin by
 * which it argues for it; returns the state to record. Every bar it consults —
 * the margin, the agreement count per edge, the minimum dwell — comes from
 * Policy.track, because a lifecycle bar is a spend decision.
 *
 * Terminal edges matter most: `dormant` stops tracking, so entering it wrongly
 * costs an item permanently, and the record of it is a T3_terminal decision.
 *
 * @param margin how far past its bar the reading argued, as a non-negative number.
 *               A reading that barely cleared its bar argues for its state exactly as
 *               much as one that cleared it by a mile under a boolean test, which is
 *               how a value oscillating ACROSS a threshold gets mistaken for one
 *               crossing it. The margin is what tells those apart.
 */
export function nextLifecycle(
  current: LifecycleReading,
  proposed: LifecycleState,
  margin: number,
  now: Millis,
  p: Policy,
): LifecycleReading {
  // Consecutive means consecutive: a reading that argues for something new restarts
  // the count at one rather than inheriting a count that was about another question.
  const agreeing = proposed === current.proposed ? current.agreeing + 1 : 1;

  // Nothing to commit. The item is already where this reading says it should be, so
  // the count is kept — a long run of agreement with the committed state is what makes
  // the eventual disagreement cheap to notice — and `since` does not move.
  if (proposed === current.state) {
    return { state: current.state, proposed, agreeing, since: current.since };
  }

  const pending: LifecycleReading = {
    state: current.state,
    proposed,
    agreeing,
    since: current.since,
  };

  // Inside the noise. The proposal is recorded and nothing is committed: this is the
  // rung that stops a value oscillating around a bar from walking the machine.
  if (!(margin >= p.track.lifecycleMargin)) return pending;

  if (agreeing < agreementRequired(current.state, proposed, p)) return pending;

  // The dwell bounds how FAST the machine can move, which the agreement count does
  // not: three readings inside one minute agree three times and have observed one
  // minute. A state must have been held this long before anything may leave it.
  if (now - current.since < p.track.minLifecycleDwellMs) return pending;

  return { state: proposed, proposed, agreeing, since: now };
}

/**
 * How many agreeing readings this particular edge costs.
 *
 * Three bars, not one, and the ordering is the cost of being wrong:
 *   - entering `dormant` is terminal. An item wrongly declared dormant is not demoted,
 *     it is gone, and its history then stops at whatever length its early performance
 *     bought it — which is the exact conditioning of the record on the outcome that
 *     track/stage.ts forbids and the holdout lane exists to measure.
 *   - falling costs more than rising, because leaving `rising` stops the dense reading
 *     at precisely the moment density was worth paying for.
 *   - rising is the cheap one. Being wrong buys a few extra reads.
 */
function agreementRequired(from: LifecycleState, to: LifecycleState, p: Policy): number {
  if (isTerminal(to)) return p.track.agreeingToDormant;
  return HEAT_ORDER.indexOf(to) > HEAT_ORDER.indexOf(from)
    ? p.track.agreeingToRise
    : p.track.agreeingToFall;
}
