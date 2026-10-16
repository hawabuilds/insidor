/**
 * THE JUNK FILTER'S FIT, ITS HELD-OUT TEST AND ITS THRESHOLD, PURE: an L2-regularised logistic
 * regression over each labelled post's words-and-picture vector (the precedents' own, 0069/0074),
 * cross-validated so every label is scored by a fit that never saw it, and the junk-probability
 * threshold chosen on those held-out scores. tools/lib/junk-filter.ts reads the labels and vectors
 * and calls this; the runner scores a live post with core `junkProbability` and the stored fit.
 *
 * Here, beside the order model's fit (score-fit.ts), so the arithmetic and the threshold rule are
 * typechecked and tested with the rest of eval. Not in core: a fit is learning, not a decision.
 *
 * ★ y = 1 IS JUNK. The owner's "Not a meme" taps and the labels file's non-memes are junk; gold,
 * missed posts, coined posts and the owner's meme calls are not. The model answers "how sure am I
 * this post is junk", so the filter can only ever drop a post it is very sure of.
 *
 * ★ THE THRESHOLD NEVER DROPS A PROTECTED POST. It is the lowest one at which no held-out hand gold
 * or missed post (`PROTECTED`) would be dropped, moved up by a margin in log-odds
 * (Policy.judge.junkFilter.margin) for the gold not yet labelled. Coined posts are taught as keep
 * and reported, not gated: the owner asked that gold and missed posts never be dropped, and a
 * coined post is weaker evidence (a creator linking a post does not prove it was the meme's origin).
 *
 * ★ FOLDS BY WHAT THE POST SAYS, NOT ITS ID. A repost or a copy carries the same words and picture
 * under another id; split by id it would sit in both halves and the test would grade the fit on
 * posts it was taught. `foldKey` is the normalised words (the id only when there are none).
 *
 * ★ DETERMINISTIC. Newton's method from all-zero weights, solved by Cholesky: no random start, no
 * sampling, so the same labels give the same fit to the last bit.
 *
 * What breaks if changed carelessly: the fit's vectors must be the ones the runner scores — core
 * `embedInput` in the adapter's post space — or the weights are of a different meaning; and the
 * class weights, or the ten-to-one share of junk among labels would push every probability up and
 * the threshold with it.
 */

import { createHash } from 'node:crypto';

/** The groups a labelled post may belong to; `not` alone is junk. */
export type JunkGroup = 'gold' | 'missed' | 'coined' | 'meme' | 'not';
/** Never dropped at the chosen threshold, on held-out scores. */
export const PROTECTED: ReadonlySet<JunkGroup> = new Set(['gold', 'missed']);
export const JUNK_GROUPS: readonly JunkGroup[] = ['gold', 'missed', 'coined', 'meme', 'not'];

export interface JunkExample {
  readonly itemId: string;
  readonly group: JunkGroup;
  /** The post's words, normalised by `foldKey` to keep copies in one fold. */
  readonly text: string;
  readonly values: ArrayLike<number>;
}

export interface JunkWeights {
  readonly intercept: number;
  readonly weights: readonly number[];
}

/* ── operational constants: how the arithmetic converges, never what is decided ────────────────── */

const NEWTON_MAX_STEPS = 50;
const NEWTON_TOLERANCE = 1e-8;

export const isJunk = (g: JunkGroup): 0 | 1 => (g === 'not' ? 1 : 0);

/* ── the split ────────────────────────────────────────────────────────────────────────────────── */

/** What decides a post's fold: its words, normalised; its id when it has none. */
export function foldKey(e: Pick<JunkExample, 'itemId' | 'text'>): string {
  const words = e.text.replace(/https?:\/\/\S+/gi, '').trim().replace(/\s+/g, ' ').toLowerCase();
  return words === '' ? `id:${e.itemId}` : `w:${words}`;
}

export function foldOf(e: Pick<JunkExample, 'itemId' | 'text'>, folds: number): number {
  return createHash('sha256').update(`junk-filter|${foldKey(e)}`).digest().readUInt32BE(0) % folds;
}

/* ── the fit ──────────────────────────────────────────────────────────────────────────────────── */

/** Solves A x = b for symmetric positive definite A (n×n, row-major), in place on a copy. */
function choleskySolve(a: Float64Array, b: Float64Array, n: number): Float64Array {
  const l = new Float64Array(a);
  for (let j = 0; j < n; j++) {
    let d = l[j * n + j] as number;
    for (let k = 0; k < j; k++) d -= (l[j * n + k] as number) ** 2;
    const s = Math.sqrt(Math.max(d, Number.MIN_VALUE));
    l[j * n + j] = s;
    for (let i = j + 1; i < n; i++) {
      let v = l[i * n + j] as number;
      const ri = i * n;
      const rj = j * n;
      for (let k = 0; k < j; k++) v -= (l[ri + k] as number) * (l[rj + k] as number);
      l[ri + j] = v / s;
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let v = b[i] as number;
    for (let k = 0; k < i; k++) v -= (l[i * n + k] as number) * (y[k] as number);
    y[i] = v / (l[i * n + i] as number);
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let v = y[i] as number;
    for (let k = i + 1; k < n; k++) v -= (l[k * n + i] as number) * (x[k] as number);
    x[i] = v / (l[i * n + i] as number);
  }
  return x;
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/**
 * L2-regularised logistic regression by Newton's method, y = 1 for junk. Each class is weighted to
 * half the total, so the share of junk among the labels does not set the intercept. The intercept
 * is not penalised.
 */
export function fitJunk(rows: readonly JunkExample[], l2: number): JunkWeights {
  const n = rows.length;
  const dim = rows[0]?.values.length ?? 0;
  const k = dim + 1;
  const junk = rows.filter((r) => isJunk(r.group) === 1).length;
  const keep = n - junk;
  const cw = (y: number): number => (junk === 0 || keep === 0 ? 1 : y === 1 ? n / (2 * junk) : n / (2 * keep));
  /* Each row with a leading 1 for the intercept. */
  const x = rows.map((r) => {
    const v = new Float64Array(k);
    v[0] = 1;
    for (let j = 0; j < dim; j++) v[j + 1] = Number(r.values[j] ?? 0);
    return v;
  });
  const beta = new Float64Array(k);
  for (let step = 0; step < NEWTON_MAX_STEPS; step++) {
    const grad = new Float64Array(k);
    const hess = new Float64Array(k * k);
    for (let j = 1; j < k; j++) {
      grad[j] = -l2 * (beta[j] as number);
      hess[j * k + j] = l2;
    }
    for (let i = 0; i < n; i++) {
      const xi = x[i] as Float64Array;
      const r = rows[i] as JunkExample;
      let z = 0;
      for (let j = 0; j < k; j++) z += (xi[j] as number) * (beta[j] as number);
      const p = sigmoid(z);
      const y = isJunk(r.group);
      const w = cw(y);
      const g = w * (y - p);
      const h = w * p * (1 - p);
      for (let a = 0; a < k; a++) {
        const xa = xi[a] as number;
        grad[a] = (grad[a] as number) + g * xa;
        if (xa === 0) continue;
        const ha = h * xa;
        const row = a * k;
        /* The upper triangle only; mirrored below. */
        for (let b = a; b < k; b++) hess[row + b] = (hess[row + b] as number) + ha * (xi[b] as number);
      }
    }
    for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) hess[a * k + b] = hess[b * k + a] as number;
    /* An unpenalised intercept over a separable set can make the Hessian's corner tiny: a hair of ridge keeps Cholesky defined. */
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

/** The probability a fit gives a vector of being junk: the same arithmetic as core `junkProbability`. */
export function junkScore(values: ArrayLike<number>, w: JunkWeights): number {
  let z = w.intercept;
  for (let j = 0; j < w.weights.length; j++) z += (w.weights[j] as number) * Number(values[j] ?? 0);
  return sigmoid(z);
}

/** Every label scored by a fit made without its fold. */
export function crossJunk(rows: readonly JunkExample[], l2: number, folds: number): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (let f = 0; f < folds; f++) {
    const test = rows.filter((r) => foldOf(r, folds) === f);
    if (test.length === 0) continue;
    const fit = fitJunk(rows.filter((r) => foldOf(r, folds) !== f), l2);
    for (const r of test) out.set(r.itemId, junkScore(r.values, fit));
  }
  return out;
}

/* ── the threshold ────────────────────────────────────────────────────────────────────────────── */

/** A probability moved by `margin` in log-odds. */
export function withMargin(p: number, margin: number): number {
  if (p <= 0 || p >= 1) return p;
  return sigmoid(Math.log(p / (1 - p)) + margin);
}

export interface Dropped {
  readonly dropped: number;
  readonly tested: number;
}

/** Each group's posts at or over `threshold`: what the filter would drop. */
export function droppedAt(rows: readonly JunkExample[], score: ReadonlyMap<string, number>, threshold: number): Readonly<Record<JunkGroup, Dropped>> {
  const out = {} as Record<JunkGroup, Dropped>;
  for (const g of JUNK_GROUPS) {
    const xs = rows.filter((r) => r.group === g && score.has(r.itemId));
    out[g] = { dropped: xs.filter((r) => (score.get(r.itemId) as number) >= threshold).length, tested: xs.length };
  }
  return out;
}

/**
 * The threshold: the highest held-out score of any protected post, moved up by `margin` in log-odds
 * (so the same margin means the same thing whether the fit's scores are spread out or bunched near
 * 1). `margin` must be over 0: a post AT the threshold is dropped. Null when there is no protected
 * post to test against, or when the answer rounds to 1 (nothing could be dropped without risking one).
 */
export function chooseThreshold(rows: readonly JunkExample[], score: ReadonlyMap<string, number>, margin: number): { readonly threshold: number | null; readonly highestProtected: number | null; readonly highestProtectedId: string | null } {
  let top: number | null = null;
  let topId: string | null = null;
  for (const r of rows) {
    const s = score.get(r.itemId);
    if (!PROTECTED.has(r.group) || s === undefined) continue;
    if (top === null || s > top) {
      top = s;
      topId = r.itemId;
    }
  }
  if (top === null) return { threshold: null, highestProtected: null, highestProtectedId: null };
  const t = withMargin(top, margin);
  return { threshold: t >= 1 || t <= top ? null : t, highestProtected: top, highestProtectedId: topId };
}
