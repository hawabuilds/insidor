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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ WHAT BREAKS IF THE ORDER IS REVERSED — that is, if backpressure protects the top
 * and sheds probation first, which is what every scheduler does by default and what
 * anyone will propose the first time the budget bites. Three consequences, and the
 * third does permanent damage.
 *
 *   1. THE BUDGET IS SPENT CONFIRMING WHAT IS ALREADY KNOWN. The fifteenth read of a
 *      confirmed riser carries almost no marginal information; the second read of an
 *      unknown carries all of it. Reversing the order sends every scarce read to the
 *      first kind, and the board gets no earlier — which is the only thing the reads
 *      were bought for.
 *
 *   2. PROBATION BECOMES A ROACH MOTEL. Nothing at the bottom of the grid ever
 *      accumulates enough evidence to leave it, so the system converges into a
 *      follower of what it already ranked — the same failure `admit/prior.ts` names
 *      for the author roster, where a prior that is also a gate makes a system that
 *      "stops finding anything".
 *
 *   3. ★ IT MAKES HISTORY LENGTH A FUNCTION OF EARLY SCORE AGAIN. Under pressure a
 *      low-scoring item gets fewer reads, so its record is shorter, so the record is
 *      conditioned on the outcome. That is verbatim what track/stage.ts forbids:
 *      "an item's history length may not depend on its early performance. That is the
 *      outcome, and conditioning the record on it poisons every model trained on the
 *      record afterwards." Reversing the shed order reintroduces the exact bug the two
 *      percent holdout exists to make measurable — and does it on the other
 *      ninety-eight percent, where nothing is watching for it.
 *
 * The first two cost money. The third costs the corpus, and it costs it silently and
 * only under load, which is when nobody is looking at data quality.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

/**
 * One tier's ask for this interval: how many reads are due, and whether they are the
 * holdout's.
 *
 * `isHeldBack` is on the DEMAND rather than looked up per item because shedding is
 * decided per tier, in bulk, under pressure — and the holdout has to be protected at the
 * same granularity the decision is made at. Held-back items are the only unbiased
 * history the system has; shedding them is the failure this whole file exists to prevent
 * and, unlike the other two costs, it is invisible until somebody tries to train.
 */
export interface ReadDemand {
  readonly tier: number;
  readonly dueCount: number;
  readonly isHeldBack: boolean;
}

/**
 * Given the reads due this interval and the budget left, return which tiers to SERVE.
 * Pure: the budget arrives as a number, never read from anywhere.
 *
 * ★ THE RETURN IS THE TIERS TO SERVE, NOT THE TIERS TO DROP. It is the obvious thing
 * to get backwards and the inversion is silent — a caller that reads it the other way
 * sheds exactly the set this file argues must never be shed, and the only symptom is a
 * corpus that quietly stops containing long histories of unremarkable items.
 *
 * ★ THE RETURNED LIST GOVERNS NON-HELD-BACK DEMAND ONLY. Held-back reads are never
 * shed under any budget, so they are not a tier the caller may or may not serve; their
 * cost is subtracted from the budget FIRST and the remainder is what the tiers compete
 * over. A holdout item whose tier is absent from this list is still read.
 *
 * ★ AND PROBATION IS SERVED EVEN WHEN IT ALONE EXCEEDS THE BUDGET. The budget is a
 * target and probation is a floor, in that order. If probation alone does not fit, the
 * read budget is genuinely too small and the answer is more budget — not a shorter
 * probation list, because a shorter probation list is the third consequence above
 * arriving through the front door.
 */
export function shed(
  demand: readonly ReadDemand[],
  readsAvailable: number,
  p: Policy,
): readonly number[] {
  const probationTier = p.track.tierMinutes.length - 1;

  // The holdout's cost is non-negotiable, so it is spent before anything competes.
  let budget = readsAvailable;
  const byTier = new Map<number, number>();
  for (const d of demand) {
    if (d.isHeldBack) {
      budget -= d.dueCount;
      continue;
    }
    byTier.set(d.tier, (byTier.get(d.tier) ?? 0) + d.dueCount);
  }

  const served = new Set<number>();

  /*
   * Keep-priority order, and it is the whole rule:
   *   probation first, then anything BELOW the shedding line, then the sheddable
   *   tiers walked from the bottom of the grid UPWARD — so the top is what runs out
   *   of budget first.
   *
   * `shedFromTier` is where shedding begins, counted from the top. Tiers with an index
   * under it are protected alongside probation, which is the knob for "protect the top
   * two as well" without touching this file.
   */
  const keepOrder: number[] = [];
  if (byTier.has(probationTier)) keepOrder.push(probationTier);
  for (let tier = probationTier - 1; tier >= 0; tier -= 1) {
    if (tier < p.track.shedFromTier && byTier.has(tier)) keepOrder.push(tier);
  }
  for (let tier = probationTier - 1; tier >= p.track.shedFromTier; tier -= 1) {
    if (byTier.has(tier)) keepOrder.push(tier);
  }

  for (const tier of keepOrder) {
    const cost = byTier.get(tier) ?? 0;
    const protectedTier = tier === probationTier || tier < p.track.shedFromTier;

    if (protectedTier) {
      // Served whatever the budget says. The overspend is real and is left visible in
      // the returned set rather than hidden by trimming the one list that may not be
      // trimmed; the caller's budget accounting is where an overspend belongs.
      served.add(tier);
      budget -= cost;
      continue;
    }

    /*
     * A tier is served whole or not at all, and the walk STOPS at the first tier that
     * does not fit rather than skipping it to find a smaller one further up.
     *
     * Skipping would produce a non-contiguous served set — a shed middle tier with a
     * served top tier above it — which is precisely the rule inverted for the one tier
     * it happened to be cheap on. The served set is a contiguous band growing upward
     * from probation, and that shape is the rule made structural.
     */
    if (cost > budget) break;
    served.add(tier);
    budget -= cost;
  }

  return [...served].sort((a, b) => a - b);
}
