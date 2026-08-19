/**
 * The arithmetic every stage shares. No thresholds live here — a number in this
 * file is a mathematical constant, never a product judgement. Product judgements
 * live in the Policy object, which is the only place a threshold is allowed to be.
 */

/* ── units ────────────────────────────────────────────────────────────── */

/**
 * Unit conversions, named once.
 *
 * A conversion is not a threshold — no amount of tuning makes a minute a
 * different number of milliseconds — but it is also not structure, so it may
 * not be a bare literal in a stage. Eight files had each declared their own
 * copy of these before they were hoisted here; eight copies of a constant is
 * seven opportunities for one of them to be wrong.
 */
export const MS_PER_SECOND = 1000;

export const MS_PER_MINUTE = 60_000;

export const MS_PER_HOUR = 3_600_000;

export const MS_PER_DAY = 86_400_000;

/** For bucketing an instant by hour of day, which is what a cohort baseline is keyed on. */
export const HOURS_PER_DAY = 24;

/** The base `Math.log10` is written in. Used where a decimal exponent is rebuilt. */
export const DECIMAL_BASE = 10;

/* ── arithmetic ───────────────────────────────────────────────────────── */

/** Squashes to [0,1] without pretending NaN is a number: NaN in, NaN out is worse. */
export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function clamp(x: number, lo: number, hi: number): number {
  if (Number.isNaN(x)) return lo;
  return x < lo ? lo : x > hi ? hi : x;
}

/** The standard logistic. Used to turn an unbounded score into a comparable one. */
export function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Linear-interpolated quantile over an unsorted sample.
 *
 * WHY core needs this at all: the admission bar is a quantile of the score
 * distribution, not a number somebody typed. The bar itself is recomputed offline
 * and frozen into Policy; this is the same arithmetic, available to eval so a
 * replay can recompute a bar under a counterfactual budget.
 *
 * @param q in [0,1]. Returns null on an empty sample rather than inventing a value.
 */
export function percentile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = clamp01(q) * (sorted.length - 1);
  const lower = sorted[Math.floor(position)];
  const upper = sorted[Math.ceil(position)];
  if (lower === undefined || upper === undefined) return null;
  return lower + (upper - lower) * (position - Math.floor(position));
}

/** Null on an empty sample, for the same reason percentile is. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

/**
 * A ratio that refuses to be infinite. A denominator of zero means "no basis for
 * comparison", which is null — not a very large number that then wins every ranking.
 */
export function safeRatio(numerator: number, denominator: number): number | null {
  if (denominator === 0 || !Number.isFinite(denominator)) return null;
  const r = numerator / denominator;
  return Number.isFinite(r) ? r : null;
}

/* ── distributions ────────────────────────────────────────────────────── */

/**
 * Where `x` sits in a sample, as a share in [0,1] — the empirical CDF, and the
 * inverse of `percentile` above.
 *
 * WHY core needs it: the wide feature sets may not log an absolute counter from a
 * source, because one source's `reach` is autoplay and another's is impressions.
 * A percentile WITHIN that source's own trailing distribution is the same statement
 * with the units divided out, so a model fitted while one source existed is still
 * valid when a second arrives. This is the arithmetic that makes that possible.
 *
 * Null on an empty sample, for the same reason `percentile` is: a rank against
 * nothing is not a rank, and 0.5 would be a claim that the value is typical.
 */
export function percentileRank(values: readonly number[], x: number): number | null {
  if (values.length === 0) return null;
  let atOrBelow = 0;
  for (const v of values) if (v <= x) atOrBelow += 1;
  return atOrBelow / values.length;
}

/**
 * The standard normal quantile — the z with P(Z <= z) = p.
 *
 * Hastings' rational approximation (Abramowitz & Stegun 26.2.23), whose absolute
 * error is under 4.5e-4 across the whole open interval. That is three orders of
 * magnitude finer than anything downstream can distinguish: its one consumer is a
 * tenth-percentile bound on an arrival rate estimated from a handful of readings,
 * where the sampling error dwarfs the approximation by a distance that is not close.
 *
 * WHY it lives here and not behind a policy field spelled as a z-score: the
 * confidence level is a product judgement and belongs in Policy as a QUANTILE, which
 * is the form a person can reason about. Turning that quantile into a deviate is
 * arithmetic, and arithmetic lives in this file.
 *
 * The endpoints are infinite and are returned as such rather than clamped: a caller
 * asking for the 0th percentile has asked for something that has no finite answer,
 * and a large finite number in its place is a lie that propagates quietly.
 */
export function normalQuantile(p: number): number {
  if (Number.isNaN(p) || p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;

  // The approximation is stated for the lower half; the distribution is symmetric,
  // so the upper half is the same computation with the sign flipped.
  const lower = p < 0.5;
  const q = lower ? p : 1 - p;

  const t = Math.sqrt(Math.log(1 / (q * q)));
  const numerator = 2.515517 + 0.802853 * t + 0.010328 * t * t;
  const denominator = 1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t;
  const z = t - numerator / denominator;

  return lower ? -z : z;
}

/**
 * The quantile of a Gamma(shape, rate) distribution, by the Wilson–Hilferty cube-root
 * transform: a Gamma raised to the one-third power is very nearly normal, so the
 * quantile is a normal quantile put back through the cube.
 *
 * WHY an approximation rather than an inverse incomplete gamma: the only consumer is
 * the lower confidence bound on a Poisson arrival rate, `Gamma⁻¹(q; a₀+R, b₀+t)`. The
 * transform's relative error at the tenth percentile is well under a percent once the
 * shape clears one, and the shape here is `a₀ + R` — the prior's own arrivals plus
 * the observed ones — so it clears one by construction. An exact inverse would be a
 * continued fraction and a root-find, and would be more code than the quantity it is
 * computing is precise enough to justify.
 *
 * Returns 0 rather than a negative number when the transform undershoots: a rate
 * cannot be negative, and the undershoot only happens in the extreme lower tail of a
 * very small shape, where the honest bound is "essentially nothing".
 */
export function gammaQuantile(p: number, shape: number, rate: number): number {
  if (!(shape > 0) || !(rate > 0)) return 0;
  const z = normalQuantile(p);
  if (!Number.isFinite(z)) return z < 0 ? 0 : Number.POSITIVE_INFINITY;
  const d = 1 / (9 * shape);
  const cube = 1 - d + z * Math.sqrt(d);
  return cube <= 0 ? 0 : (shape * cube * cube * cube) / rate;
}

/* ── special functions ────────────────────────────────────────────────── */

/**
 * ★ WHY THESE THREE LIVE HERE AND NOWHERE ELSE.
 *
 * `detect/poisson.ts` needs the upper tail of a negative binomial, which is a
 * regularized incomplete beta, which needs a log-gamma. Every one of those carries
 * bare numeric constants that are the ALGORITHM rather than a judgement — the Lanczos
 * coefficients are not a threshold anybody may tune, and no amount of product thinking
 * makes them different numbers. `tools/check-policy.mjs` exempts exactly one file for
 * exactly that reason, and this is it. Putting them in `poisson.ts` fails CI, and
 * correctly: the check cannot tell a fitted constant from a bar, so the rule is
 * positional and the position is here.
 *
 * ★ AND WHY EVERY ONE OF THEM RETURNS A LOGARITHM. The quantity being computed is an
 * upper-tail probability, and an interesting one underflows to exactly 0 in double
 * precision long before it stops being interesting — a count of 60 against an
 * expectation of 2 is somewhere around 1e-40 and still perfectly ordinary input.
 * `−log10(0)` is `Infinity`, `Infinity` propagates silently into `Decision.score`, and
 * `decide()` has no invariant that catches it. So the probability is never materialised
 * at all: the tail is computed in log space and handed to the caller as a log.
 */

/* Lanczos, g = 5, n = 7. These are the approximation, not a choice. */
const LANCZOS_G = 5;
const LANCZOS_SERIES_BASE = 1.000000000190015;
const LANCZOS_COEFFICIENTS = [
  76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
  0.1208650973866179e-2, -0.5395239384953e-5,
];
const SQRT_TWO_PI = 2.5066282746310005;

/* Continued fractions converge geometrically here; 300 is far past where any input
   this system produces stops moving. TINY is a guard against a zero denominator
   mid-fraction, not a tolerance. */
const CF_MAX_ITERATIONS = 300;
const CF_EPSILON = 1e-12;
const CF_TINY = 1e-300;

/** ln Γ(x), for x > 0. Throws rather than returning NaN: a NaN here becomes a score. */
export function logGamma(x: number): number {
  if (!(x > 0)) throw new RangeError(`logGamma: defined for x > 0, got ${x}`);
  let y = x;
  let tmp = x + LANCZOS_G + 0.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let series = LANCZOS_SERIES_BASE;
  for (const c of LANCZOS_COEFFICIENTS) {
    y += 1;
    series += c / y;
  }
  return -tmp + Math.log((SQRT_TWO_PI * series) / x);
}

/** The modified Lentz continued fraction behind the incomplete beta. */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < CF_TINY) d = CF_TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= CF_MAX_ITERATIONS; m += 1) {
    const m2 = 2 * m;
    const even = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + even * d;
    if (Math.abs(d) < CF_TINY) d = CF_TINY;
    c = 1 + even / c;
    if (Math.abs(c) < CF_TINY) c = CF_TINY;
    d = 1 / d;
    h *= d * c;
    const odd = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + odd * d;
    if (Math.abs(d) < CF_TINY) d = CF_TINY;
    c = 1 + odd / c;
    if (Math.abs(c) < CF_TINY) c = CF_TINY;
    d = 1 / d;
    const step = d * c;
    h *= step;
    if (Math.abs(step - 1) < CF_EPSILON) break;
  }
  return h;
}

/**
 * ln I_x(a, b) — the natural log of the regularized incomplete beta.
 *
 * The branch on `x` is the standard one and it is also the reason a log form is
 * cheap: below the switch point the answer is a product of a leading exponential and
 * a continued fraction, so the log is the log of the leading term plus the log of the
 * fraction and nothing was ever small enough to underflow. Above it the answer is
 * near one, where a log is uninteresting and `log1p` is exact.
 */
export function logRegularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (!(a > 0) || !(b > 0)) {
    throw new RangeError(`logRegularizedIncompleteBeta: a and b must be positive, got ${a}, ${b}`);
  }
  if (x <= 0) return -Infinity;
  if (x >= 1) return 0;
  const logFront =
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x);
  if (x < (a + 1) / (a + b + 2)) {
    return logFront + Math.log(betaContinuedFraction(a, b, x) / a);
  }
  return Math.log1p(-Math.exp(logFront) * (betaContinuedFraction(b, a, 1 - x) / b));
}

/** The series form of P(a, x), convergent for x < a+1, returned as a log. */
function lowerGammaSeriesLog(a: number, x: number): number {
  let ap = a;
  let step = 1 / a;
  let sum = step;
  for (let n = 0; n < CF_MAX_ITERATIONS; n += 1) {
    ap += 1;
    step *= x / ap;
    sum += step;
    if (Math.abs(step) < Math.abs(sum) * CF_EPSILON) break;
  }
  return Math.log(sum) - x + a * Math.log(x) - logGamma(a);
}

/** The continued-fraction form of Q(a, x) = 1 − P(a, x), convergent for x >= a+1. */
function upperGammaContinuedFraction(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / CF_TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= CF_MAX_ITERATIONS; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < CF_TINY) d = CF_TINY;
    c = b + an / c;
    if (Math.abs(c) < CF_TINY) c = CF_TINY;
    d = 1 / d;
    const step = d * c;
    h *= step;
    if (Math.abs(step - 1) < CF_EPSILON) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/**
 * ln P(a, x) — the natural log of the regularized LOWER incomplete gamma.
 *
 * This is the Poisson upper tail: for X ~ Poisson(μ), P(X >= n) = P(n, μ). It exists
 * so that "Poisson is the negative binomial's limit as the dispersion goes to
 * infinity" is a code path with a test on it rather than a sentence in a comment.
 */
export function logRegularizedLowerIncompleteGamma(a: number, x: number): number {
  if (!(a > 0)) throw new RangeError(`logRegularizedLowerIncompleteGamma: a must be > 0, got ${a}`);
  if (x <= 0) return -Infinity;
  if (x < a + 1) return lowerGammaSeriesLog(a, x);
  return Math.log1p(-upperGammaContinuedFraction(a, x));
}
