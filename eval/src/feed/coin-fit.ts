/**
 * OUR OWN COIN MODEL'S FIT, ITS TIME-SPLIT TEST AND ITS THRESHOLD, PURE: a class-weighted, L2
 * logistic regression over core `coinModelFeatures` (standardised here) and the post's vector,
 * solved exactly by Newton's method, and the owner's table at several thresholds.
 * tools/lib/coin-model.ts reads the rows and calls this; the runner scores with core
 * `coinModelProbability` and the stored fit.
 *
 * Here, beside the junk filter's fit (junk-fit.ts, whose Cholesky it shares), so the arithmetic and
 * the table are typechecked and tested with the rest of eval. Not in core: a fit is learning, not a
 * decision. Not in ml/train: it must refit unattended at the 20:00 re-tune.
 *
 * ★ y = 1 IS "COINED". Each class weighs half the total, so the share of coined posts among the
 * rows (a few in a hundred, and sampled negatives) does not set the intercept; the probability is
 * a ranking with a threshold chosen on held-out time, not a calibrated chance.
 *
 * ★ THE TEST IS TIME AND THE OWNER'S HALF. Rows are split by decision time: the fit sees only the
 * older ones, the l2 and the threshold are chosen on the newest slice of those, and the table is
 * read on posts newer than every one it was taught. The owner's held-out missed posts are never
 * taught, whatever their time.
 *
 * ★ JUNK IS THE OLD JUDGES' LABELS OR THE OWNER'S TAP. A post the judge said no to was never on
 * For You, so the owner never tapped it: the extra posts' junk is read from the old answers
 * (tools/lib/junk-sample.ts `oldLabel`), the owner's tap first where there is one, and unclear or
 * unlabelled posts are left out of both sides of the share.
 *
 * What breaks if changed carelessly: the standardisation must be computed on the training rows
 * only (a test mean is a peek at the test), and stored with the fit — core reads it back by name.
 */

import { choleskySolve } from './junk-fit.ts';

/* ── operational constants: how the arithmetic converges, never what is decided ────────────────── */

const NEWTON_MAX_STEPS = 40;
const NEWTON_TOLERANCE = 1e-7;

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

export interface FitRow {
  /** The standardised named part, then the vector part (zeros when the post has none). */
  readonly x: Float64Array;
  readonly y: 0 | 1;
}

/** Mean and spread of each named feature over the training rows; a constant feature gets spread 0 (never scored). */
export function standardisation(features: readonly Readonly<Record<string, number | null>>[], names: readonly string[]): { readonly means: number[]; readonly spreads: number[] } {
  const means: number[] = [];
  const spreads: number[] = [];
  for (const n of names) {
    let s = 0;
    let c = 0;
    for (const f of features) {
      const v = f[n];
      if (v !== null && v !== undefined && Number.isFinite(v)) {
        s += v;
        c += 1;
      }
    }
    const m = c === 0 ? 0 : s / c;
    let q = 0;
    for (const f of features) {
      const v = f[n];
      if (v !== null && v !== undefined && Number.isFinite(v)) q += (v - m) ** 2;
    }
    means.push(m);
    spreads.push(c < 2 ? 0 : Math.sqrt(q / (c - 1)));
  }
  return { means, spreads };
}

export interface LogisticFit {
  readonly intercept: number;
  readonly weights: readonly number[];
}

/**
 * Class-weighted L2 logistic regression by Newton's method from all-zero weights: deterministic to
 * the last bit. The intercept is not penalised.
 */
export function fitLogistic(rows: readonly FitRow[], l2: number): LogisticFit {
  const n = rows.length;
  const dim = rows[0]?.x.length ?? 0;
  const k = dim + 1;
  const pos = rows.filter((r) => r.y === 1).length;
  const neg = n - pos;
  const cw = (y: number): number => (pos === 0 || neg === 0 ? 1 : y === 1 ? n / (2 * pos) : n / (2 * neg));
  const beta = new Float64Array(k);
  for (let step = 0; step < NEWTON_MAX_STEPS; step++) {
    const grad = new Float64Array(k);
    const hess = new Float64Array(k * k);
    for (let j = 1; j < k; j++) {
      grad[j] = -l2 * (beta[j] as number);
      hess[j * k + j] = l2;
    }
    const xi = new Float64Array(k);
    xi[0] = 1;
    const nz = new Int32Array(k);
    for (const r of rows) {
      xi.set(r.x, 1);
      let m = 0;
      let z = 0;
      for (let j = 0; j < k; j++) {
        const v = xi[j] as number;
        if (v !== 0) {
          nz[m++] = j;
          z += v * (beta[j] as number);
        }
      }
      const p = sigmoid(z);
      const w = cw(r.y);
      const g = w * (r.y - p);
      const h = w * p * (1 - p);
      for (let ai = 0; ai < m; ai++) {
        const a = nz[ai] as number;
        const xa = xi[a] as number;
        grad[a] = (grad[a] as number) + g * xa;
        const ha = h * xa;
        const row = a * k;
        for (let bi = ai; bi < m; bi++) {
          const b = nz[bi] as number;
          hess[row + b] = (hess[row + b] as number) + ha * (xi[b] as number);
        }
      }
    }
    for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) hess[a * k + b] = hess[b * k + a] as number;
    hess[0] = (hess[0] as number) + NEWTON_TOLERANCE;
    const delta = choleskySolve(hess, grad, k);
    let move = 0;
    for (let j = 0; j < k; j++) {
      beta[j] = (beta[j] as number) + (delta[j] as number);
      move = Math.max(move, Math.abs(delta[j] as number));
    }
    if (move < NEWTON_TOLERANCE) break;
  }
  return { intercept: beta[0] as number, weights: Array.from(beta.subarray(1)) };
}

export function scoreRow(x: ArrayLike<number>, f: LogisticFit): number {
  let z = f.intercept;
  for (let j = 0; j < f.weights.length; j++) z += (f.weights[j] as number) * (x[j] as number);
  return sigmoid(z);
}

/** Average precision of scores against labels: how well coined posts rank above the rest. */
export function averagePrecision(scored: readonly { readonly score: number; readonly y: 0 | 1 }[]): number | null {
  const pos = scored.filter((s) => s.y === 1).length;
  if (pos === 0) return null;
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  let hits = 0;
  let sum = 0;
  sorted.forEach((s, i) => {
    if (s.y === 1) {
      hits += 1;
      sum += hits / (i + 1);
    }
  });
  return sum / pos;
}

/* ── the owner's table ────────────────────────────────────────────────────────────────────────── */

/** One post of a test window, as the table counts it. */
export interface TablePost {
  readonly itemId: string;
  readonly score: number;
  readonly coined: boolean;
  /** It went on For You with the judge as it is (public.feed_post). */
  readonly shown: boolean;
  /** The judge's newest answer is "no": the only posts the net may add. */
  readonly judgeNo: boolean;
  /** It clears For You's other gates (reach bar inside the age bar, no held kind, no owner Not a meme). */
  readonly gates: boolean;
  /** Junk by the owner's tap, else the old judges' label; null when unclear or unlabelled. */
  readonly junk: boolean | null;
  /** The owner tapped it Not a meme: the owner's own junk measure, which only shown posts can have. */
  readonly tappedNot: boolean;
}

export interface TableRow {
  readonly threshold: number;
  readonly extras: number;
  readonly extrasPerHour: number;
  /** Of the extras with a junk label: how many are junk, of how many. */
  readonly extrasJunk: { readonly junk: number; readonly labelled: number };
  /** Of the extras, how many were coined (late, by others). */
  readonly extrasCoined: number;
  /** The owner's Not a meme taps among For You's posts with the judge alone, of how many shown. */
  readonly tapsAlone: { readonly not: number; readonly shown: number };
  readonly coined: { readonly alone: number; readonly combined: number; readonly model: number; readonly of: number };
  /** For You's junk share, judge alone and with the net, over labelled posts. */
  readonly junkAlone: number | null;
  readonly junkCombined: number | null;
  /** Combined minus alone, in points of share (0.03 is three points). */
  readonly junkRise: number | null;
}

/** Would the net add this post at `threshold`. */
export const added = (p: TablePost, threshold: number): boolean => !p.shown && p.judgeNo && p.gates && p.score >= threshold;

export function tableRow(posts: readonly TablePost[], threshold: number, hours: number): TableRow {
  const extras = posts.filter((p) => added(p, threshold));
  const shown = posts.filter((p) => p.shown);
  const share = (xs: readonly TablePost[]): { junk: number; labelled: number } => ({ junk: xs.filter((p) => p.junk === true).length, labelled: xs.filter((p) => p.junk !== null).length });
  const alone = share(shown);
  const both = share([...shown, ...extras]);
  const ex = share(extras);
  const coined = posts.filter((p) => p.coined);
  const junkAlone = alone.labelled === 0 ? null : alone.junk / alone.labelled;
  const junkCombined = both.labelled === 0 ? null : both.junk / both.labelled;
  return {
    threshold,
    extras: extras.length,
    extrasPerHour: hours > 0 ? extras.length / hours : 0,
    extrasJunk: ex,
    extrasCoined: extras.filter((p) => p.coined).length,
    tapsAlone: { not: shown.filter((p) => p.tappedNot).length, shown: shown.length },
    coined: { alone: coined.filter((p) => p.shown).length, combined: coined.filter((p) => p.shown || added(p, threshold)).length, model: coined.filter((p) => p.score >= threshold).length, of: coined.length },
    junkAlone,
    junkCombined,
    junkRise: junkAlone === null || junkCombined === null ? null : junkCombined - junkAlone,
  };
}

/**
 * The lowest threshold of `grid` whose junk rise is at most `maxRise` and extras per hour at most
 * `maxPerHour`: the most posts the net may add within the owner's bars. Null when none qualifies.
 */
export function chooseThreshold(posts: readonly TablePost[], grid: readonly number[], hours: number, maxRise: number, maxPerHour: number): number | null {
  for (const t of [...grid].sort((a, b) => a - b)) {
    const r = tableRow(posts, t, hours);
    if ((r.junkRise === null || r.junkRise <= maxRise) && r.extrasPerHour <= maxPerHour) return t;
  }
  return null;
}

/** Thresholds from 0.05 to 0.995: the table's rows and the choice's grid. */
export const THRESHOLDS: readonly number[] = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.93, 0.95, 0.97, 0.98, 0.99, 0.995];
