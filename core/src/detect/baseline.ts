/**
 * What we expected, which is the whole difficulty. Two baselines, and neither may be
 * used alone.
 *
 *   SELF       — the subject's own trailing behaviour. Sensitive, early, and under
 *                the adversary's control in BOTH directions: depress it with filler,
 *                then buy engagement on the target. A gate an attacker can open by
 *                buying a hundred approvals is worse than no gate, so the self
 *                baseline is a re-ranker inside a hard absolute floor, never a
 *                standalone trigger.
 *   POPULATION — the median for the cohort at this hour of the day. Robust, slower,
 *                and blind to a subject that is unusual for itself but ordinary for
 *                everyone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ THE TWO BLINDNESSES ARE COMPLEMENTARY, WHICH IS WHY BOTH BARS ARE REQUIRED.
 * SELF cannot see a subject that is ordinary for itself but extraordinary for its
 * cohort — a large account with a genuinely huge item. POPULATION cannot see a subject
 * that is extraordinary for itself but ordinary for its cohort — the small account,
 * which is where lead time actually lives. Requiring both, inside the absolute floor,
 * is what makes the pair a detector rather than two half-detectors.
 *
 * ★ NO HISTORY IS NOT ZERO HISTORY, and this file's entire contract is that sentence.
 * A fit over nothing returns `reads: 0` and an expectation of zero, and the CALLER
 * abstains on it. What it must never do is fabricate a usable baseline, because the
 * fabrication that suggests itself — `expectation = 0` — is the worst possible one: it
 * makes every count infinitely surprising, so a brand-new account alerts on its first
 * reading, for ever. That is the exact shape of the censored-rate-as-zero bug
 * kinetics/rate.ts documents, pointed at the accounts an adversary creates for free.
 *
 * ★ WHAT ACTUALLY FILLS THE GAP AT COLD START is not a fabricated self baseline, it is
 * the POPULATION one. The cohort fit is the self fit's prior: with shrinkage `n/(n+k)`
 * toward the cohort expectation — applied by stage.ts, where the policy lives — a
 * subject with almost no history simply inherits its cohort's expectation and migrates
 * to its own as evidence accumulates. This is why the cohort must be fitted even when
 * the self fit is usable, and it is the same mechanism `admit/prior.ts` uses for the
 * author roster: two stages, one idea.
 *
 * ★ NEITHER FUNCTION APPLIES `minBaselineReads`. `Baseline.reads` is reported and the
 * bar is the caller's, which is not an oversight — the bar decides a VERDICT (D1
 * versus D4 versus a real answer) and a fit that silently returned nothing would make
 * those three indistinguishable at the only place they can be told apart.
 */

import type { DetectPolicy } from '@insidor/contracts/policy.ts';
import type { CounterKind, Millis } from '@insidor/contracts/vocabulary.ts';

import { HOURS_PER_DAY, MS_PER_HOUR, clamp } from '../math.ts';

export interface Baseline {
  /**
   * The fitted mean ARRIVAL COUNT over `Policy.detect.countWindowMin`, not a rate and
   * not a level. `eta` compares a count against it, so the two have to be in the same
   * unit or the bars mean nothing; the conversion from the per-minute rates that come
   * in happens here, once, rather than at each of the call sites.
   */
  readonly expectation: number;
  readonly dispersion: number;
  /** How many readings it was fitted on. Below Policy.detect.minBaselineReads it is unusable. */
  readonly reads: number;
  /**
   * The hour-of-day bucket this fit is FOR, or null for a fit that is not hour-keyed.
   *
   * It exists so the `at` a cohort fit was made for survives into the feature vector:
   * a count that is remarkable at 04:00 is ordinary at 20:00, and a baseline compared
   * against the wrong hour is wrong in a way nothing downstream can detect. Recording
   * which hour it was fitted for is what makes that mistake findable later.
   */
  readonly hourOfDay: number | null;
}

/** The empty fit. Never usable, never fabricated, and never an expectation of zero. */
function unfitted(hourOfDay: number | null): Baseline {
  return { expectation: 0, dispersion: 0, reads: 0, hourOfDay };
}

/**
 * A negative-binomial fit over the subject's own trailing readings.
 *
 * ★ THE DISPERSION IS THE PRIOR, NOT AN ESTIMATE, and that is what `kind` is for.
 * `minBaselineReads` is 2 and `selfBaselineReads` is 12; a dispersion estimated from
 * a handful of points is noise wearing a parameter's name, and the direction it errs
 * in is the dangerous one — an underdispersed sample of three would claim
 * tighter-than-Poisson spread and manufacture certainty at exactly the low baselines
 * this whole file exists to be careful about. So the spread comes from
 * `dispersionByKind`, which is the only reason this function needs to know the kind.
 *
 * ★ THE TRAILING WINDOW IS COUNTED IN READINGS, NOT IN TIME, and the truncation
 * happens HERE rather than at the call site. The caller passing "the trailing rates"
 * without a stated length is how two callers produce two different baselines from the
 * same history with nothing recording which — so the length is policy and this
 * function enforces it.
 *
 * @param rates the subject's own per-minute rates, NEWEST LAST. Only measured rates
 *              belong here: a censored reading carries no rate, and dropping it is
 *              correct precisely because putting a zero in its place would drag the
 *              expectation down and make the next real reading look extraordinary.
 */
export function selfBaseline(
  rates: readonly number[],
  kind: CounterKind,
  p: DetectPolicy,
): Baseline {
  const trailing = rates.slice(-p.selfBaselineReads);
  if (trailing.length === 0) return unfitted(null);

  let total = 0;
  for (const r of trailing) total += r;
  const expectation = (total / trailing.length) * p.countWindowMin;

  return {
    expectation,
    dispersion: dispersionFor(kind, p),
    reads: trailing.length,
    hourOfDay: null,
  };
}

/**
 * The cohort baseline, keyed by (source, hour of day). The key is built by the
 * adapter's baselineKey() so that the cohort definition belongs to whoever knows what
 * the source's numbers mean — this file only consumes the fitted result.
 *
 * ★ WHY THE HOUR IS PART OF THE KEY AND NOT A CORRECTION APPLIED AFTERWARDS: a count
 * that is remarkable at 04:00 is ordinary at 20:00. Without an hour term every
 * baseline silently encodes the daily cycle as signal, and the stage's busiest alerting
 * period becomes whenever the source's audience wakes up.
 *
 * ★ AND WHY THIS ONE MAY ESTIMATE ITS DISPERSION WHERE `selfBaseline` MAY NOT: a
 * cohort is many subjects, which is the entire point of having one. Method of moments
 * on `Var = μ + μ²/r` is meaningful over a real sample and meaningless over three
 * readings of one account.
 *
 * ★ THE ESTIMATE MAY ONLY EVER MAKE US LESS CERTAIN. It is clamped to at most the
 * per-kind prior, so a cohort that happens to look underdispersed cannot buy a tighter
 * tail than the prior allows. The asymmetry is deliberate and it is the same one the
 * policy field argues for: too tight a tail is a false-positive generator aimed at
 * cheaply-created accounts, and too loose a tail only costs us an alert.
 *
 * @param cohortRates per-minute rates of the already-selected cohort. One entry per
 *                    member; order is irrelevant, unlike the self fit.
 * @param at          the instant this fit is FOR. Names the hour bucket, and is
 *                    recorded on the result so a mismatch is findable afterwards.
 */
export function populationBaseline(
  cohortRates: readonly number[],
  at: Millis,
  kind: CounterKind,
  p: DetectPolicy,
): Baseline {
  const hourOfDay = hourOfDayAt(at);
  if (cohortRates.length === 0) return unfitted(hourOfDay);

  const counts = cohortRates.map((r) => r * p.countWindowMin);

  let total = 0;
  for (const c of counts) total += c;
  const expectation = total / counts.length;

  return {
    expectation,
    dispersion: estimatedDispersion(counts, expectation, kind, p),
    reads: counts.length,
    hourOfDay,
  };
}

/* ── internals ────────────────────────────────────────────────────────── */

function dispersionFor(kind: CounterKind, p: DetectPolicy): number {
  // The floor is a floor and not a default: a prior below it would produce a tail so
  // flat that nothing is ever surprising, which is silence dressed as a detector.
  return Math.max(p.dispersionByKind[kind], p.dispersionFloor);
}

/**
 * Method of moments on `Var = μ + μ²/r`, so `r = μ² / (Var − μ)`.
 *
 * Falls back to the prior in the two cases where the estimate says nothing: a sample
 * too small to have a variance, and a sample whose variance does not exceed its mean.
 * The second is the interesting one — an underdispersed sample is evidence that the
 * cohort is tighter than Poisson, and this function is not willing to act on that,
 * because acting on it is how a quiet cohort turns into a hair trigger.
 */
function estimatedDispersion(
  counts: readonly number[],
  expectation: number,
  kind: CounterKind,
  p: DetectPolicy,
): number {
  const prior = dispersionFor(kind, p);
  if (counts.length < p.minBaselineReads || expectation <= 0) return prior;

  let squaredError = 0;
  for (const c of counts) squaredError += (c - expectation) * (c - expectation);
  const variance = squaredError / (counts.length - 1);

  const excess = variance - expectation;
  if (!(excess > 0)) return prior;

  const estimate = (expectation * expectation) / excess;
  // Clamped ABOVE by the prior: the sample may argue for more spread, never for less.
  return clamp(estimate, p.dispersionFloor, prior);
}

function hourOfDayAt(at: Millis): number {
  const hours = Math.floor(at / MS_PER_HOUR);
  // Modulo of a negative instant is negative in this language; pre-epoch instants are
  // not a real input but a silently negative hour bucket would be a silent bug.
  return ((hours % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
}
