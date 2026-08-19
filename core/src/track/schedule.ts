/**
 * When to read an item again.
 *
 * The grid is geometric and dense at the start — the first few minutes are where a
 * difference is informative, and an item read once an hour has no kinetics at all.
 * The tier an item sits on is a function of its last score; the minutes per tier are
 * in Policy.track.tierMinutes.
 *
 * THE FAILURE THIS MUST NOT REPEAT: the previous scheduler stopped tracking three
 * hours after first sight and pruned cold items after ten minutes, which made an
 * item's history length a function of its early performance — that is, of the
 * outcome. Every history in the corpus was therefore conditioned on the thing being
 * predicted, which is why the holdout lane exists and why it bypasses this file's
 * budget logic entirely.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ WHY GEOMETRIC, in four sentences that all point the same way.
 *
 * The successive ratios of `[4, 9, 14, 21, 30, 42, 58, 78]` are 2.25, 1.56, 1.50,
 * 1.43, 1.40, 1.38, 1.34 — a roughly constant multiplier of about 1.4 after a
 * deliberately sharper first step, spanning a 20× range in eight reads.
 *
 *   1. The informative quantity is a RATIO and ratios live on a log axis. Everything
 *      downstream is scale-free by construction: `burst` is fast/slow, `eta` is a tail
 *      against an expectation. Equal MULTIPLICATIVE spacing delivers equal information
 *      per read; an arithmetic grid oversamples the flat tail and undersamples the bend.
 *   2. Reads are money, and the resolution is needed where the curve bends, which is
 *      the first minutes. A dense front end buys the most curvature per dollar.
 *   3. The kinetics are matched to it. `fastTauMin: 20` and `slowTauMin: 360` straddle
 *      the grid, and ewma.ts's continuous-time form is what makes the irregularity safe
 *      — without it a geometric grid would be a bias generator that inflated exactly
 *      the items it read most.
 *   4. The first two intervals pay for the whole schedule: `burst` is available at the
 *      SECOND reading, which is where the product's earliness claim is actually made.
 *
 * ★ AND THE PROPERTY THAT MATTERS MORE THAN THE SHAPE: THE GRID DEGRADES, IT DOES NOT
 * TERMINATE. A cold item slides down one tier at a time to 78 minutes and stays there.
 * It is never pruned. `maxTrackedHours` is the only stop and the holdout bypasses even
 * that. "Tracking never stops early because an item looked cold" is not a nicety here,
 * it is the difference between a corpus that can be trained on and one that cannot.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import type { Millis } from '@insidor/contracts/vocabulary.ts';

import { MS_PER_MINUTE, clamp } from '../math.ts';

export interface Schedule {
  readonly tier: number;
  readonly dueAt: Millis;
}

/**
 * Map a score onto a tier via Policy.track.tierCutoffs, then add that tier's interval
 * to the last read.
 *
 * Two things it must do that are easy to leave out:
 *   - Never move an item more than one tier per read. A single noisy reading should
 *     not promote an item to the top of the grid, because the top of the grid is
 *     where the money goes.
 *   - Ignore the tier entirely for holdout items: they are on the full grid for
 *     their whole life, whatever they score, or they are not a holdout.
 *
 * ★ `currentTier` IS A PARAMETER THE STUB DID NOT DECLARE, and without it the first of
 * those two rules cannot be written at all: "no more than one tier per read" is
 * relative to the tier the item is on, and a function that cannot see the current tier
 * cannot clamp against it. `TrackInput.tier` exists, so the caller has always had the
 * value; the signature simply did not ask for it.
 *
 * @param score the item's last decided score. null means NO EVIDENCE, which holds the
 *              current tier rather than dropping to probation — the same
 *              absence-is-not-zero rule the rest of the system runs on, applied to the
 *              scheduler. Treating an unscored item as a zero-scoring one would demote
 *              every new arrival on its first pass, which is precisely where the dense
 *              reading is worth the most.
 */
export function nextRead(
  lastReadAt: Millis,
  currentTier: number,
  score: number | null,
  isHeldBack: boolean,
  p: Policy,
): Schedule {
  const grid = p.track.tierMinutes;
  const topTier = 0;
  const probationTier = grid.length - 1;

  // The holdout is on the full grid for its whole life, whatever it scores. No cutoff
  // is consulted, no clamp is applied, and the tier it was on is irrelevant: an item
  // whose read cadence depended on its score would not be measuring what the scored
  // lane gets wrong, it would be a slightly slower copy of it.
  const tier = isHeldBack
    ? topTier
    : clamp(oneStepToward(tierForScore(score, currentTier, p), currentTier), topTier, probationTier);

  const minutes = grid[tier] ?? grid[probationTier] ?? 0;
  return { tier, dueAt: lastReadAt + minutes * MS_PER_MINUTE };
}

/**
 * The tier a score alone argues for. Cutoffs are descending and there is one fewer of
 * them than there are tiers, so the last tier is what an item that clears no cutoff
 * lands on — probation, which is where lead time is made rather than where items go
 * to be forgotten.
 */
function tierForScore(score: number | null, currentTier: number, p: Policy): number {
  if (score === null) return currentTier;
  const cutoffs = p.track.tierCutoffs;
  for (let i = 0; i < cutoffs.length; i += 1) {
    const cutoff = cutoffs[i];
    if (cutoff !== undefined && score >= cutoff) return i;
  }
  return cutoffs.length;
}

/**
 * At most one tier of movement per read, in EITHER direction.
 *
 * The doc's stated reason covers promotion: a single noisy reading must not teleport
 * an item to the top of the grid, because the top of the grid is where the money goes.
 * The clamp is symmetric anyway, and the reason for that half is the more important
 * one — an item that can fall from tier 0 to probation on one bad reading has a
 * history length that tracks its early performance, which is the outcome. A gradual
 * demotion is the difference between "we read it less often" and "we stopped".
 */
function oneStepToward(target: number, from: number): number {
  if (target > from) return from + 1;
  if (target < from) return from - 1;
  return from;
}
