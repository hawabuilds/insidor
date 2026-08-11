/**
 * What to stop reading when the read budget runs short.
 *
 * Backpressure drops tiers FROM THE TOP DOWN, which is counter-intuitive and is the
 * point: the top tier is the items we are already confident about, and re-reading a
 * confirmed riser buys almost nothing. The bottom of the grid is probation — items we
 * have not made our minds up about — and probation is where lead time is made. A
 * shedding rule that protects the top is a rule that spends its scarce reads
 * confirming what it already believes.
 *
 * Probation is never shed. Neither is the holdout: exploration is recoverable by
 * re-enabling it, a hole in the unbiased record is not.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { notImplemented } from '../not-implemented.ts';

export interface ReadDemand {
  readonly tier: number;
  readonly dueCount: number;
  readonly isHeldBack: boolean;
}

/**
 * TO BUILD: given the reads due this interval and the budget left, return which
 * tiers to serve. Pure: the budget arrives as a number, never read from anywhere.
 */
export function shed(
  _demand: readonly ReadDemand[],
  _readsAvailable: number,
  _p: Policy,
): readonly number[] {
  return notImplemented('track/shed.ts: budget backpressure, top-down, probation last');
}
