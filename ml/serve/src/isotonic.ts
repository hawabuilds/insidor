/**
 * Isotonic calibration: score → probability, monotone, in TypeScript.
 *
 * WHY IT IS HERE RATHER THAN IN PYTHON: calibration is the FAST layer. The
 * ranking model retrains weekly, on a fixed day, with a human reading a report.
 * Calibration refits daily against the last seven resolved days, automatically,
 * and it is what absorbs market movement between retrains. A daily job that
 * needed Python would put Python on a schedule, and the moment anything under
 * services/ shells out to Python the single-runtime property is gone and nobody
 * decided to lose it. Pool-adjacent-violators is about forty lines. Take them.
 *
 * WHY IT IS NOT IN THE MODEL FILE: LightGBM's dump does not contain the
 * calibrator. It is a separate artefact with its own interpolation and
 * out-of-bounds semantics, and it must be exported and matched deliberately —
 * which is why `ml/train/export.py` writes it into the artefact sidecar.
 *
 * The two layers this file separates, because conflating them is how a
 * "recalibration" quietly becomes a retrain:
 *   fit()   — offline or nightly. Consumes resolved labels.
 *   apply() — serving. Pure, sync, no labels anywhere near it.
 */

/**
 * The exported calibrator: breakpoints and their fitted values, plus the
 * out-of-bounds rule stated rather than assumed. `clip` means a score below the
 * first breakpoint takes the first value and one above the last takes the last —
 * never an extrapolated probability outside [y0, yN], which is how a calibrator
 * starts emitting 1.03.
 */
export interface IsotonicCalibration {
  readonly x: readonly number[];
  readonly y: readonly number[];
  readonly outOfBounds: 'clip';
  /** Rows the fit was computed over. A calibrator fitted on 11 rows is a rumour. */
  readonly n: number;
}

export interface CalibrationPoint {
  /** The uncalibrated score. */
  readonly x: number;
  /** The realised outcome: 0 or 1 for a binary label, or any real for a rate. */
  readonly y: number;
  /** Sample weight. Defaults to 1. Used for inverse-propensity and log-rate reweighting. */
  readonly w?: number;
}

export class CalibrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalibrationError';
  }
}

/**
 * Pool adjacent violators, weighted, with ties on x merged first.
 *
 * The output is the same object scikit-learn's `IsotonicRegression` produces:
 * the kept breakpoints of a piecewise-linear interpolant. Redundant collinear
 * interior points are dropped so the artefact stays small and so two fits over
 * the same data compare equal.
 */
export function fitIsotonic(points: readonly CalibrationPoint[]): IsotonicCalibration {
  if (points.length === 0) throw new CalibrationError('cannot fit a calibrator on zero points');

  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      throw new CalibrationError('calibration points must be finite; a NaN score means the walker was fed a bad row');
    }
    if (p.w !== undefined && (!Number.isFinite(p.w) || p.w <= 0)) {
      throw new CalibrationError('calibration weights must be finite and positive');
    }
  }

  const sorted = [...points].sort((a, b) => a.x - b.x);

  // Merge exact ties on x into one weighted point. Two rows with the same score
  // and different outcomes are not a monotonicity violation; they are one point.
  const xs: number[] = [];
  const sums: number[] = [];
  const weights: number[] = [];
  for (const p of sorted) {
    const w = p.w ?? 1;
    const last = xs.length - 1;
    if (last >= 0 && xs[last] === p.x) {
      sums[last] = (sums[last] ?? 0) + p.y * w;
      weights[last] = (weights[last] ?? 0) + w;
    } else {
      xs.push(p.x);
      sums.push(p.y * w);
      weights.push(w);
    }
  }

  // PAVA over blocks. Each block holds a summed value and a summed weight; the
  // block's fitted value is their ratio, and blocks merge while the sequence
  // decreases.
  const blockX: number[] = [];
  const blockSum: number[] = [];
  const blockW: number[] = [];
  const blockCount: number[] = [];

  for (let i = 0; i < xs.length; i++) {
    blockX.push(xs[i] ?? 0);
    blockSum.push(sums[i] ?? 0);
    blockW.push(weights[i] ?? 0);
    blockCount.push(1);

    while (blockX.length > 1) {
      const j = blockX.length - 1;
      const prevMean = (blockSum[j - 1] ?? 0) / (blockW[j - 1] ?? 1);
      const curMean = (blockSum[j] ?? 0) / (blockW[j] ?? 1);
      if (prevMean <= curMean) break;
      blockSum[j - 1] = (blockSum[j - 1] ?? 0) + (blockSum[j] ?? 0);
      blockW[j - 1] = (blockW[j - 1] ?? 0) + (blockW[j] ?? 0);
      blockCount[j - 1] = (blockCount[j - 1] ?? 0) + (blockCount[j] ?? 0);
      blockX.pop();
      blockSum.pop();
      blockW.pop();
      blockCount.pop();
    }
  }

  // Expand blocks back to one fitted value per distinct x.
  const fitted: number[] = [];
  let cursor = 0;
  for (let b = 0; b < blockX.length; b++) {
    const mean = (blockSum[b] ?? 0) / (blockW[b] ?? 1);
    const count = blockCount[b] ?? 0;
    for (let k = 0; k < count; k++) {
      fitted[cursor] = mean;
      cursor++;
    }
  }

  const { x, y } = dropCollinear(xs, fitted);
  return { x, y, outOfBounds: 'clip', n: points.length };
}

/**
 * Remove interior points that lie on the straight line between their
 * neighbours. Cosmetic for the arithmetic, load-bearing for the artefact: a
 * calibrator fitted on 40,000 rows otherwise carries 40,000 breakpoints.
 */
function dropCollinear(xs: readonly number[], ys: readonly number[]): { x: number[]; y: number[] } {
  if (xs.length <= 2) return { x: [...xs], y: [...ys] };

  const x: number[] = [xs[0] ?? 0];
  const y: number[] = [ys[0] ?? 0];
  for (let i = 1; i < xs.length - 1; i++) {
    const x0 = x[x.length - 1] ?? 0;
    const y0 = y[y.length - 1] ?? 0;
    const x1 = xs[i] ?? 0;
    const y1 = ys[i] ?? 0;
    const x2 = xs[i + 1] ?? 0;
    const y2 = ys[i + 1] ?? 0;
    const onLine = (y1 - y0) * (x2 - x0) === (y2 - y0) * (x1 - x0);
    if (!onLine) {
      x.push(x1);
      y.push(y1);
    }
  }
  x.push(xs[xs.length - 1] ?? 0);
  y.push(ys[ys.length - 1] ?? 0);
  return { x, y };
}

/**
 * Apply the calibrator. Linear interpolation between breakpoints, clipped
 * outside them. Pure, sync, allocation-free.
 */
export function applyIsotonic(cal: IsotonicCalibration, score: number): number {
  const { x, y } = cal;
  const last = x.length - 1;
  if (last < 0) throw new CalibrationError('calibrator has no breakpoints');
  if (Number.isNaN(score)) throw new CalibrationError('cannot calibrate NaN');

  const x0 = x[0] ?? 0;
  const xLast = x[last] ?? 0;
  if (score <= x0) return y[0] ?? 0;
  if (score >= xLast) return y[last] ?? 0;

  // Binary search for the bracketing interval.
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((x[mid] ?? 0) <= score) lo = mid;
    else hi = mid;
  }

  const xa = x[lo] ?? 0;
  const xb = x[hi] ?? 0;
  const ya = y[lo] ?? 0;
  const yb = y[hi] ?? 0;
  if (xb === xa) return yb;
  return ya + ((yb - ya) * (score - xa)) / (xb - xa);
}

/** Runtime validation of a calibrator read off an artefact sidecar. */
export function parseCalibration(raw: unknown): IsotonicCalibration {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const x = r['x'];
  const y = r['y'];
  if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length || x.length === 0) {
    throw new CalibrationError('calibration must carry equal-length, non-empty x and y arrays');
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = y[i];
    if (typeof xi !== 'number' || !Number.isFinite(xi)) throw new CalibrationError(`calibration x[${i}] is not finite`);
    if (typeof yi !== 'number' || !Number.isFinite(yi)) throw new CalibrationError(`calibration y[${i}] is not finite`);
    const prevX = xs[i - 1];
    const prevY = ys[i - 1];
    if (prevX !== undefined && xi < prevX) throw new CalibrationError('calibration x must be non-decreasing');
    if (prevY !== undefined && yi < prevY) throw new CalibrationError('calibration y must be non-decreasing');
    xs.push(xi);
    ys.push(yi);
  }
  if (r['outOfBounds'] !== undefined && r['outOfBounds'] !== 'clip') {
    throw new CalibrationError(`out-of-bounds rule ${JSON.stringify(r['outOfBounds'])} is not implemented`);
  }
  const n = typeof r['n'] === 'number' ? r['n'] : xs.length;
  return { x: xs, y: ys, outOfBounds: 'clip', n };
}
