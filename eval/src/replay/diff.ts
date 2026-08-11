/**
 * Reading a replay result.
 *
 * The number people ask for is "how many flipped", and on its own it is close to
 * useless: 400 flips is a disaster if 380 of them are pass→drop on subjects that
 * later produced a matched mint, and a nothing if they are drop→drop with a
 * renamed reason. So everything here decomposes the flip count along the axis
 * that changes what you would do about it.
 */

import type { Verdict } from '@insidor/contracts';
import type { ReasonCode } from '@insidor/contracts/reasons.ts';
import type { ReplayResult } from './harness.ts';

export const VERDICTS = ['pass', 'hold', 'drop', 'abstain'] as const;

export interface TransitionCell {
  readonly before: Verdict;
  readonly after: Verdict;
  readonly count: number;
}

export function transitionMatrix(r: ReplayResult): TransitionCell[] {
  const cells: TransitionCell[] = [];
  for (const before of VERDICTS) {
    for (const after of VERDICTS) {
      const count = r.transitions.get(`${before}→${after}`) ?? 0;
      if (count > 0) cells.push({ before, after, count });
    }
  }
  return cells;
}

export function countTransition(r: ReplayResult, before: Verdict, after: Verdict): number {
  return r.transitions.get(`${before}→${after}`) ?? 0;
}

export interface ReplaySummary {
  readonly considered: number;
  /** Subjects the candidate policy would newly admit. Costs tracking budget. */
  readonly newlyAdmitted: number;
  /**
   * Subjects the candidate policy would newly reject. ★ The expensive direction.
   * A tightened gate is invisible in production — the items simply never appear —
   * so this number is the only place the cost of a threshold change is legible
   * before it is paid.
   */
  readonly newlyRejected: number;
  /** Same verdict, different named reason. Usually a refactor, occasionally a bug. */
  readonly reasonOnly: number;
  readonly unchanged: number;
  readonly churnRate: number;
  /** New reasons, most frequent first. Where a threshold change actually landed. */
  readonly topNewReasons: readonly { readonly reason: ReasonCode; readonly count: number }[];
}

export function summarise(r: ReplayResult, topN: number): ReplaySummary {
  let newlyAdmitted = 0;
  let newlyRejected = 0;
  for (const v of VERDICTS) {
    if (v === 'pass') continue;
    newlyAdmitted += countTransition(r, v, 'pass');
    newlyRejected += countTransition(r, 'pass', v);
  }

  const verdictFlips = newlyAdmitted + newlyRejected;
  const reasonOnly = Math.max(0, r.flips - verdictFlips);

  const topNewReasons = [...r.newReasons.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);

  return {
    considered: r.considered,
    newlyAdmitted,
    newlyRejected,
    reasonOnly,
    unchanged: r.considered - r.flips,
    churnRate: r.considered === 0 ? 0 : r.flips / r.considered,
    topNewReasons,
  };
}
