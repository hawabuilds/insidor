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
 * ★ y = 1 IS THE TARGET'S YES: "coined", or "memeable and about to go viral" (0099). Each class
 * weighs half the total, so the share of yes posts among the rows (a few in a hundred, and sampled
 * negatives) does not set the intercept; the probability is a ranking with a threshold chosen on
 * held-out time, not a calibrated chance.
 *
 * ★ ONE RULER FOR EVERY TARGET. The table counts the target's own yes (`hit`) and, beside it, the
 * scorecard's measures (tools/lib/scorecard.ts) on the same posts whatever the target: memeable %,
 * earliness, coverage of memeable viral posts before the early share of the line. So the coined
 * fit, the viral fit and the judge alone are read side by side on one test window.
 *
 * ★ A ROW MAY WEIGH LESS THAN ONE (`w`, the owner 2026-10-18: his "seen and kept" posts are softer
 * yes labels than an explicit one). The class weights are taken over the summed row weights, so a
 * half-weight yes moves the intercept half as much as a full one.
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
  /** The row's own weight; absent is 1. */
  readonly w?: number;
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
  const dim = rows[0]?.x.length ?? 0;
  const k = dim + 1;
  /* Every class weighs half the summed row weight: with all rows at 1 this is n / (2 · class count). */
  let pos = 0;
  let neg = 0;
  for (const r of rows) if (r.y === 1) pos += r.w ?? 1;
  else neg += r.w ?? 1;
  const total = pos + neg;
  const cw = (y: number): number => (pos === 0 || neg === 0 ? 1 : y === 1 ? total / (2 * pos) : total / (2 * neg));
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
      const w = cw(r.y) * (r.w ?? 1);
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
  /** The target's own yes, as measured (coined late by others; or memeable and viral). Never a soft yes. */
  readonly hit: boolean;
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
  /**
   * The scorecard's measures, the same for every target so two fits are read on one ruler:
   * `memeViral` it went over the viral line from under it at its decision and the owner never
   * called it not a meme; `earlyAtMs` its first reading at the early share of the line (null:
   * never); `shownAtMs` when For You first showed it; `addAtMs` when the net would have added it
   * (its decision, or the first reading after it that clears the reach bar; null: never clears);
   * `viewsShown` and `viewsAdd` the newest reading by then; `views24` its views a day after
   * posting (the scorecard's `NEAR_24H_MS` rule, else its highest reading).
   */
  readonly memeViral: boolean;
  readonly earlyAtMs: number | null;
  readonly shownAtMs: number | null;
  readonly addAtMs: number | null;
  readonly viewsShown: number | null;
  readonly viewsAdd: number | null;
  readonly views24: number | null;
}

/** Earliness of a set of posts: the median share of their day's views they had when they went on For You. */
export interface Earliness {
  readonly n: number;
  readonly medianShare: number | null;
  readonly medianViewsAt: number | null;
  readonly median24: number | null;
}

export interface TableRow {
  readonly threshold: number;
  readonly extras: number;
  readonly extrasPerHour: number;
  /** Of the extras with a junk label: how many are junk, of how many. */
  readonly extrasJunk: { readonly junk: number; readonly labelled: number };
  /** Of the extras, how many are the target's yes. */
  readonly extrasHit: number;
  /** Of the extras, how many went viral from under the line and are not the owner's Not a meme. */
  readonly extrasMemeViral: number;
  /** The owner's Not a meme taps among For You's posts with the judge alone, of how many shown. */
  readonly tapsAlone: { readonly not: number; readonly shown: number };
  readonly hits: { readonly alone: number; readonly combined: number; readonly model: number; readonly of: number };
  /** For You's junk share, judge alone and with the net, over labelled posts. */
  readonly junkAlone: number | null;
  readonly junkCombined: number | null;
  /** Combined minus alone, in points of share (0.03 is three points). */
  readonly junkRise: number | null;
  /** Memeable share over labelled posts (one minus junk): For You alone, with the net, the extras alone. */
  readonly memeable: { readonly alone: number | null; readonly combined: number | null; readonly extras: number | null };
  readonly earliness: { readonly alone: Earliness; readonly extras: Earliness; readonly combined: Earliness };
  /**
   * Of the memeable viral posts in the window, how many were on For You before the early share of
   * the line: judge alone, with the net (shown early, or added early), and the net's adds alone.
   */
  readonly coverage: { readonly alone: number; readonly combined: number; readonly model: number; readonly of: number };
}

/** Would the net add this post at `threshold`. */
export const added = (p: TablePost, threshold: number): boolean => !p.shown && p.judgeNo && p.gates && p.score >= threshold;

const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/** Earliness over (views then, views a day on) pairs; a post missing either is left out, never a zero. */
export function earliness(pairs: readonly { readonly at: number | null; readonly day: number | null }[]): Earliness {
  const both = pairs.filter((x): x is { at: number; day: number } => x.at !== null && x.day !== null && x.day > 0);
  return {
    n: both.length,
    medianShare: median(both.map((x) => Math.min(1, x.at / x.day))),
    medianViewsAt: median(both.map((x) => x.at)),
    median24: median(both.map((x) => x.day)),
  };
}

/** On For You at `at`, before `deadline` (a post that never reached the early share has no deadline). */
const before = (at: number | null, deadline: number | null): boolean => at !== null && (deadline === null || at < deadline);

export function tableRow(posts: readonly TablePost[], threshold: number, hours: number): TableRow {
  const extras = posts.filter((p) => added(p, threshold));
  const shown = posts.filter((p) => p.shown);
  const share = (xs: readonly TablePost[]): { junk: number; labelled: number } => ({ junk: xs.filter((p) => p.junk === true).length, labelled: xs.filter((p) => p.junk !== null).length });
  const alone = share(shown);
  const both = share([...shown, ...extras]);
  const ex = share(extras);
  const hit = posts.filter((p) => p.hit);
  const junkAlone = alone.labelled === 0 ? null : alone.junk / alone.labelled;
  const junkCombined = both.labelled === 0 ? null : both.junk / both.labelled;
  const memeShare = (x: { junk: number; labelled: number }): number | null => (x.labelled === 0 ? null : 1 - x.junk / x.labelled);
  const atShown = shown.map((p) => ({ at: p.viewsShown, day: p.views24 }));
  const atAdd = extras.map((p) => ({ at: p.viewsAdd, day: p.views24 }));
  const mv = posts.filter((p) => p.memeViral);
  const shownEarly = (p: TablePost): boolean => p.shown && before(p.shownAtMs, p.earlyAtMs);
  const addedEarly = (p: TablePost): boolean => added(p, threshold) && before(p.addAtMs, p.earlyAtMs);
  return {
    threshold,
    extras: extras.length,
    extrasPerHour: hours > 0 ? extras.length / hours : 0,
    extrasJunk: ex,
    extrasHit: extras.filter((p) => p.hit).length,
    extrasMemeViral: extras.filter((p) => p.memeViral).length,
    tapsAlone: { not: shown.filter((p) => p.tappedNot).length, shown: shown.length },
    hits: { alone: hit.filter((p) => p.shown).length, combined: hit.filter((p) => p.shown || added(p, threshold)).length, model: hit.filter((p) => p.score >= threshold).length, of: hit.length },
    junkAlone,
    junkCombined,
    junkRise: junkAlone === null || junkCombined === null ? null : junkCombined - junkAlone,
    memeable: { alone: memeShare(alone), combined: memeShare(both), extras: memeShare(ex) },
    earliness: { alone: earliness(atShown), extras: earliness(atAdd), combined: earliness([...atShown, ...atAdd]) },
    coverage: { alone: mv.filter(shownEarly).length, combined: mv.filter((p) => shownEarly(p) || addedEarly(p)).length, model: mv.filter(addedEarly).length, of: mv.length },
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

/**
 * The score at which `scores` passes as many posts as `passes` (the judge's count on the same posts):
 * the judge in training read at the judge's own volume, so the two are compared post for post and
 * neither looks better by passing more. Null when there is nothing to match (no posts, or the judge
 * passed none or all). Kept strictly inside (0, 1), as a stored threshold must be.
 */
export function matchedThreshold(scores: readonly number[], passes: number): number | null {
  if (passes <= 0 || passes >= scores.length) return null;
  const sorted = [...scores].sort((a, b) => b - a);
  const t = sorted[passes - 1] as number;
  return Math.min(Math.max(t, Number.MIN_VALUE), 1 - Number.EPSILON);
}

