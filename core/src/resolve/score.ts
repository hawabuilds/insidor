/**
 * How much each surviving candidate looks like the asset this story produced.
 *
 * Five channels, weighted, and every one of them arrives as a number computed
 * somewhere that is allowed to do work — a representation similarity from the embed
 * port, a hash distance from the media pipeline, a collision statistic from the
 * store. This file only weighs them, which is what keeps the stage replayable.
 *
 * TWO RULES THAT LOOK LIKE DETAILS AND ARE NOT:
 *
 * 1. The symbol channel is symbol agreement TIMES its collision statistic. A symbol
 *    is an observation about an asset, never an identifier: one phrase can produce
 *    hundreds of assets carrying the same symbol, so agreeing on a symbol that
 *    everything carries is worth nothing, and agreeing on a rare one is worth a lot.
 *    Multiplying is how that gets said.
 *
 * 2. A channel we could not measure scores ZERO and is NOT renormalised away. A
 *    renormalising score would let a candidate with one measurable channel look
 *    exactly as convincing as one with five, and the candidate with one measurable
 *    channel is precisely the thin, new, unverifiable asset we must be most careful
 *    about.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { clamp01 } from '../math.ts';

/**
 * The scoring channels for one candidate. All in [0,1]; null means "not measured",
 * which is a distinct state from "measured and zero" and is kept distinct all the
 * way into the frozen feature vector.
 */
export interface CandidateSignals {
  /** Agreement between the story's proposed name and the asset's observed symbol. */
  readonly symbol: number | null;
  /** How rare that symbol is on this venue right now. High means informative. */
  readonly collisionIdf: number | null;
  /** Representation similarity between the story's text and the asset's metadata. */
  readonly semantic: number | null;
  /** Perceptual hash agreement between the story's image and the asset's image. */
  readonly image: number | null;
  /** The issuer's own declared links pointing back at the story. Attacker-controlled. */
  readonly declared: number | null;
}

/**
 * The time channel: how well the asset's origin sits inside the story's window.
 *
 * Linear decay across the window, deliberately. The measured post-to-mint lag is a
 * few minutes against a window measured in hours, so almost every honest candidate
 * lands near the top of this — which is correct: time is what makes a candidate
 * eligible, and it is the OTHER channels that are supposed to separate them. The
 * fitted lag prior that replaces this needs adjudicated labels, and those arrive
 * from the abstains this stage logs.
 */
export function temporalScore(lagMs: number | null, p: Policy): number {
  if (lagMs === null) return 0;
  const span = p.resolve.maxLagMs - p.resolve.minLagMs;
  if (!(span > 0)) return 0;
  return clamp01(1 - (lagMs - p.resolve.minLagMs) / span);
}

/** The weighted score. Nothing here is calibrated; the bar it is compared against is. */
export function candidateScore(signals: CandidateSignals, lagMs: number | null, p: Policy): number {
  const w = p.resolve.scoreWeights;
  return clamp01(
    w.temporal * temporalScore(lagMs, p) +
      w.symbol * clamp01((signals.symbol ?? 0) * (signals.collisionIdf ?? 0)) +
      w.semantic * clamp01(signals.semantic ?? 0) +
      w.image * clamp01(signals.image ?? 0) +
      w.declared * clamp01(signals.declared ?? 0),
  );
}
