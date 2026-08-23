/**
 * One ranking primitive, both lanes.
 *
 *   heat = (rate × √burst × quality)^alpha / ((ageMin + t0)/t0)^gamma
 *
 * A shrunk arrival rate of a countable event, times a scale-free burst ratio,
 * penalised by age, scaled by a quality multiplier. The two lanes differ only in
 * which counter feeds the rate and which function computes the quality — one counts
 * spread, the other counts trading — so there is one function here and not two.
 *
 * ★ CANDIDATE ISOLATION, which is a product requirement and not a tuning choice:
 * every term depends only on the item being scored. No term references another
 * candidate. The consequences are the ones the product needs — the board does not
 * reshuffle because an unrelated story arrived, and any row's position is
 * reproducible from its own stored feature vector, which is what makes a replay of a
 * past board possible at all.
 *
 * The cost of that is real and should be recorded rather than discovered: list-level
 * objectives like "do not show three assets from the same story" cannot be expressed
 * here. They are a post-selection filter over the ranked list, and they belong in a
 * different file for that reason.
 *
 * The shrunk rate is the caller's job. Feeding a raw rate in reintroduces the
 * small-sample problem this whole design is trying to avoid: a brand-new item with
 * one lucky reading outranks an item with an hour of evidence.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

export interface HeatInputs {
  /** A shrunk, normalised arrival rate. Never a raw count and never an absolute level. */
  readonly rateLcbNorm: number;
  /** fast/slow. Scale-free, so it is comparable between the two lanes and all sources. */
  readonly burst: number;
  /** Lane-specific multiplier in [0,1]. The only place the two lanes differ. */
  readonly quality: number;
  readonly ageMin: number;
}

/**
 * The ranking score: rate × √burst × quality, compressed by `alpha`, divided by age.
 *
 * ★ WHY BURST IS UNDER A SQUARE ROOT rather than entering linearly. Burst is a RATIO of
 * two decays, so it is unbounded above — a lull followed by any activity at all produces
 * an enormous fast/slow — and multiplying by it directly lets one such item take the top
 * of the board away from something with an hour of consistent evidence behind it. The
 * root keeps burst as a strong tiebreaker while making the rate the thing that decides.
 *
 * ★ AND WHY AGE IS A DIVISOR AND NOT A MULTIPLIER. `t0Min` shifts the curve so that a
 * minutes-old item is not dividing by something near zero, which would be an infinity
 * rather than a very fresh item. Age decays what is already there; it never manufactures
 * heat from nothing, which is what an additive freshness bonus would do.
 *
 * `base <= 0` short-circuits to 0 rather than falling into `Math.pow`, because a
 * fractional exponent over a negative base is NaN, and a NaN reaching `Decision.score`
 * would sort unpredictably and be invisible in the row.
 */
export function heat(o: HeatInputs, p: Policy): number {
  const base = o.rateLcbNorm * Math.sqrt(Math.max(o.burst, 0)) * o.quality;
  if (base <= 0) return 0;
  const age = Math.pow((Math.max(o.ageMin, 0) + p.rank.t0Min) / p.rank.t0Min, p.rank.gamma);
  return Math.pow(base, p.rank.alpha) / age;
}
