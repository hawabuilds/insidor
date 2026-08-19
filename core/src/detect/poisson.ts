/**
 * eta — how atypical is this count, given what we expected?
 *
 *   eta = −log10 P(X ≥ n | expectation)
 *
 * WHY this shape and not a threshold on the count: eta is a ratio to an expectation,
 * so it is comparable across sources, across hours of the day and across accounts of
 * wildly different sizes, without a per-source constant that has to be re-derived
 * every time a vendor changes. A count of forty is extraordinary for one account and
 * a quiet afternoon for another; eta says which.
 *
 * TWO CORRECTIONS THAT MUST SURVIVE INTO THE IMPLEMENTATION, both measured:
 *
 *   - The variance axis is the EXPECTED COUNT, not the item's age. Under Poisson-ish
 *     noise the spread goes as 1/√μ, and μ spans two to three orders of magnitude
 *     across accounts at a single age. A table of standard deviations indexed by age
 *     cannot flatten that and will systematically over-alert on small accounts.
 *   - log1p on small counts biases the account baseline downward, which inflates the
 *     score for low-baseline accounts — a false-positive generator aimed precisely at
 *     the accounts an adversary can cheaply create. Fit a negative binomial, which
 *     handles zeros natively.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ THE FILE IS NAMED FOR THE STATISTIC AND ITS LINEAGE, NOT FOR THE DISTRIBUTION,
 * and the difference is worth one paragraph so the next reader does not re-open it.
 *
 * `eta = −log10 P(X ≥ n | expectation)` is the figure of merit an open-sourced trend
 * detector introduced and named; the SHAPE of the merit function is what the filename
 * records. The distribution under the tail is a free choice, and this design takes the
 * strictly more general one. A Poisson asserts `Var = μ`. Real social counts are not
 * that: they arrive in bursts, one resharer with a large audience drags a whole
 * cascade behind them, and the same account posts in clumps. The negative binomial
 * says `Var = μ + μ²/r`.
 *
 * The difference is not academic and it points in the dangerous direction. At `μ = 2`,
 * a count of 12 has a Poisson upper tail near 1e-6, so `eta ≈ 6` — comfortably over
 * `etaSelfBar: 3`. Under a negative binomial with `r = 1` the same count sits near
 * 1e-2, so `eta ≈ 2`, under the bar. Poisson MANUFACTURES CERTAINTY AT LOW BASELINES,
 * and low-baseline accounts are exactly the population an adversary can create for
 * free. It is the same attack the log1p note above describes, arriving by a second
 * road; the negative binomial is the repair for both.
 *
 * ★ AND THE POISSON IS A CODE PATH RATHER THAN A COMMENT. The Poisson is the negative
 * binomial's own limit as `r → ∞`, so a non-finite dispersion takes the exact Poisson
 * tail. That makes "Poisson is the limit" a property with a test on it instead of a
 * sentence somebody hopes is true.
 *
 * ★ NOTHING HERE MATERIALISES A PROBABILITY. The tail underflows to exactly 0 in
 * double precision well before it stops being interesting, `−log10(0)` is `Infinity`,
 * and an `Infinity` would ride into `Decision.score` through a `decide()` that has no
 * invariant against it. The arithmetic is done in log space in math.ts and only ever
 * comes back as a log. There is no line in this file where a probability exists.
 */

import { logRegularizedIncompleteBeta, logRegularizedLowerIncompleteGamma } from '../math.ts';

/**
 * The upper-tail probability of a count under a fitted expectation, returned as
 * −log10 so that bigger is more surprising and the scale is readable.
 *
 *   P(X = k)  = Γ(k+r)/(k! Γ(r)) · (r/(r+μ))^r · (μ/(r+μ))^k
 *   P(X ≥ n)  = I_{μ/(μ+r)}(n, r)
 *   eta       = −log10 P(X ≥ n)
 *
 * @param count       the arrivals observed in the window
 * @param expectation the fitted mean for this subject in this window
 * @param dispersion  the negative-binomial dispersion. Poisson is the limit as this
 *                    goes to infinity; real counts are always more spread than that,
 *                    and assuming they are not is what produces confident nonsense.
 */
export function eta(count: number, expectation: number, dispersion: number): number {
  /*
   * ★ A NON-POSITIVE EXPECTATION THROWS RATHER THAN RETURNING A LARGE NUMBER, and it
   * is the most important line in the file.
   *
   * `expectation = 0` is the mirror image of the censored-rate-as-zero bug that
   * kinetics/rate.ts exists to prevent: it makes EVERY count infinitely surprising, so
   * an item with no history alerts on its first reading, for ever, on exactly the
   * accounts an adversary can create for free. A missing baseline is an absent input.
   * The caller's job is to abstain — `D1_insufficient_history` when the fit is too
   * thin, `D4_baseline_unavailable` when there is no cohort — and reaching this
   * function without having done so is a bug in the caller, which is what a throw
   * says and a fallback value does not.
   */
  if (!(expectation > 0)) {
    throw new RangeError(
      `eta: expectation must be positive, got ${expectation}. ` +
        'An absent baseline is not an expectation of zero — the caller abstains instead.',
    );
  }
  if (!(dispersion > 0)) {
    throw new RangeError(`eta: dispersion must be positive, got ${dispersion}`);
  }
  if (!Number.isFinite(count) || count < 0) {
    throw new RangeError(`eta: count must be a non-negative finite number, got ${count}`);
  }

  /*
   * The count arrives as a rate times a window, so it is fractional, and the tail is
   * defined on integers. It is floored rather than rounded: flooring makes the tail
   * LARGER and the eta SMALLER, so the rounding error can only ever cost us an alert.
   * Rounding up would borrow evidence we do not have, and the error this stage can
   * afford is silence.
   */
  const n = Math.floor(count);

  // P(X ≥ 0) = 1 exactly, for every parameterisation. Nothing observed, nothing odd.
  if (n <= 0) return 0;

  const logTail = Number.isFinite(dispersion)
    ? logRegularizedIncompleteBeta(n, dispersion, expectation / (expectation + dispersion))
    : logRegularizedLowerIncompleteGamma(n, expectation);

  return -logTail / Math.LN10;
}
