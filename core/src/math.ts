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
