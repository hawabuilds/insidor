/**
 * THE FOR YOU ORDER MODEL'S FIT AND ITS GATE, PURE: an L2-regularised logistic regression over each
 * post's separate signals (core `postSignals`), the fixed held-out split, the held-out rates, and
 * whether a new fit may replace the one in use. tools/lib/score-model.ts reads the labels and the
 * stored facts and calls this; the projector scores with core `postRankScore` and the fit's terms.
 *
 * Here, beside the judge's examples (examples.ts), and not in tools/, so the arithmetic and the gate
 * are typechecked and tested with the rest of eval. Not in core: a fit is learning, not a decision,
 * and its convergence constants are arithmetic, not policy.
 *
 * ★ DETERMINISTIC. Newton's method from all-zero weights: no random start, no sampling, no order
 * dependence beyond the rows' own order, so the same labels give the same fit to the last bit.
 *
 * ★ A FIXED SHARE IS HELD OUT, BY THE POST ID ALONE (Policy.learning.scoreHeldOutShare). A post
 * held out today is held out at every slot, so a fit applied last week is tested today on posts it
 * never saw — the only way "no worse than the fit in use" means anything.
 *
 * ★ THE GATE: at the bar in force (a post passes when today's rules pass it AND, with a bar, its
 * number clears it) hand gold and missed may not pass fewer, live non-memes may not pass more; and
 * the held-out order (how often a gated positive is put above a non-meme) may not be worse — all
 * against the fit in use or, the first time, today's rules alone (a passing post above a failing
 * one, nothing else). With no bar the rates cannot move, so the order is what decides.
 *
 * What breaks if changed carelessly: `isHeldOut` must stay a pure function of the id; and a value
 * term must stay standardised, or "how much each signal counts" stops comparing across signals.
 */

import { createHash } from 'node:crypto';

import { postRankScore, termInput, SCORE_SIGNALS, type PostSignals, type ScoreFit, type ScoreTerm } from '@insidor/core';

export type LabelGroup = 'gold' | 'missed' | 'recall' | 'meme' | 'not';
export const POSITIVE: ReadonlySet<LabelGroup> = new Set(['gold', 'missed', 'recall', 'meme']);

export interface Example {
  readonly itemId: string;
  readonly group: LabelGroup;
  readonly y: 0 | 1;
  readonly heldOut: boolean;
  readonly signals: PostSignals;
  /** Today's rules alone (core postScoreReason), without the owner's call: the system's own answer. */
  readonly rulesPass: boolean;
}

/* ── operational constants: how the arithmetic converges, never what is decided ────────────────── */

const NEWTON_MAX_STEPS = 100;
const NEWTON_TOLERANCE = 1e-10;
/** The bars the owner's trade-off table lists. */
export const TABLE_BARS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] as const;

/* ── the split ────────────────────────────────────────────────────────────────────────────────── */

/** A fixed share of posts by the hash of the id: the same post is held out at every slot. */
export function isHeldOut(itemId: string, share: number): boolean {
  const h = createHash('sha256').update(`score-model|${itemId}`).digest();
  return h.readUInt32BE(0) / 0x1_0000_0000 < share;
}

/** A post's fold for the cross-validated table: four more bytes of the same hash, so folds and the held-out split are independent. */
export function foldOf(itemId: string, folds: number): number {
  const h = createHash('sha256').update(`score-model|${itemId}`).digest();
  return h.readUInt32BE(4) % folds;
}

/* ── the fit ──────────────────────────────────────────────────────────────────────────────────── */

/** Solves A x = b by Gaussian elimination with partial pivoting. A is small and positive definite. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] as number]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs((m[r] as number[])[c] as number) > Math.abs((m[piv] as number[])[c] as number)) piv = r;
    [m[c], m[piv]] = [m[piv] as number[], m[c] as number[]];
    const row = m[c] as number[];
    const d = row[c] as number;
    for (let r = c + 1; r < n; r++) {
      const other = m[r] as number[];
      const f = (other[c] as number) / d;
      for (let k = c; k <= n; k++) other[k] = (other[k] as number) - f * (row[k] as number);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    const row = m[r] as number[];
    let s = row[n] as number;
    for (let k = r + 1; k < n; k++) s -= (row[k] as number) * (x[k] as number);
    x[r] = s / (row[r] as number);
  }
  return x;
}

/**
 * The terms a fit is offered: each signal's standardised value when it varies among the fitted
 * posts, and its missing indicator when some are missing and some are not. A signal missing for
 * every fitted post (crypto attention before it is held) offers nothing.
 */
export function termsFor(rows: readonly Example[]): Omit<ScoreTerm, 'weight'>[] {
  const terms: Omit<ScoreTerm, 'weight'>[] = [];
  for (const s of SCORE_SIGNALS) {
    const present = rows.map((r) => r.signals[s]).filter((v): v is number => v !== null);
    if (present.length === 0) continue;
    const centre = present.reduce((a, v) => a + v, 0) / present.length;
    const spread = Math.sqrt(present.reduce((a, v) => a + (v - centre) ** 2, 0) / present.length);
    if (spread > 0) terms.push({ signal: s, kind: 'value', centre, spread });
    /* The judge's belief is missing exactly when `judge_unjudged` is set: that indicator is its missing term. */
    if (present.length < rows.length && s !== 'judge_belief') terms.push({ signal: s, kind: 'missing', centre: 0, spread: 1 });
  }
  return terms;
}

/**
 * L2-regularised logistic regression by Newton's method: deterministic, no random start. Each
 * class is weighted to half the total, so the ten-to-one share of non-memes does not set the
 * intercept and 0.5 sits between the two. The intercept is not penalised.
 */
export function fitLogistic(rows: readonly Example[], l2: number): ScoreFit {
  const shape = termsFor(rows);
  const x = rows.map((r) => [1, ...shape.map((t) => termInputOf(t, r.signals))]);
  const pos = rows.filter((r) => r.y === 1).length;
  const neg = rows.length - pos;
  const w = rows.map((r) => (pos === 0 || neg === 0 ? 1 : r.y === 1 ? rows.length / (2 * pos) : rows.length / (2 * neg)));
  const k = shape.length + 1;
  let beta = new Array<number>(k).fill(0);
  for (let step = 0; step < NEWTON_MAX_STEPS; step++) {
    const grad = beta.map((b, j) => (j === 0 ? 0 : -l2 * b));
    const hess = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j && i > 0 ? l2 : 0)));
    rows.forEach((r, i) => {
      const xi = x[i] as number[];
      const z = xi.reduce((a, v, j) => a + v * (beta[j] as number), 0);
      const p = 1 / (1 + Math.exp(-z));
      const wi = w[i] as number;
      for (let a = 0; a < k; a++) {
        grad[a] = (grad[a] as number) + wi * (r.y - p) * (xi[a] as number);
        const ha = hess[a] as number[];
        for (let b = 0; b < k; b++) ha[b] = (ha[b] as number) + wi * p * (1 - p) * (xi[a] as number) * (xi[b] as number);
      }
    });
    const delta = solve(hess, grad);
    beta = beta.map((b, j) => b + (delta[j] as number));
    if (Math.max(...delta.map(Math.abs)) < NEWTON_TOLERANCE) break;
  }
  return { intercept: beta[0] as number, terms: shape.map((t, j) => ({ ...t, weight: beta[j + 1] as number })) };
}

const termInputOf = (t: Omit<ScoreTerm, 'weight'>, s: PostSignals): number => termInput(t, s);

/* ── the test ─────────────────────────────────────────────────────────────────────────────────── */

export interface Rate {
  readonly passed: number;
  readonly tested: number;
}
/* ★ HAND GOLD HERE INCLUDES THE OWNER'S OWN "MEME" CALLS (taps and the labels file). The judge's
   re-tune keeps them out of its gold only because it teaches them to the judge; this fit holds its
   test posts out by hash, so the owner's hand labels can test it. Recall additions stay information. */
export const GATED = { hand: ['gold', 'missed', 'meme'], negatives: ['not'], missed: ['missed'] } as const;

/** Each group's passed-of-tested when a post passes on `passes`. */
export function ratesOf(rows: readonly Example[], passes: (r: Example) => boolean) {
  const of = (groups: readonly LabelGroup[]): Rate => {
    const g = rows.filter((r) => groups.includes(r.group));
    return { passed: g.filter(passes).length, tested: g.length };
  };
  return { hand: of(GATED.hand), negatives: of(GATED.negatives), missed: of(GATED.missed), recall: of(['recall']), meme: of(['meme']) };
}

/**
 * How often a gated positive (hand gold or missed) is ordered above a held-out non-meme: the area
 * under the curve, ties counting half. Null when either side is empty.
 */
export function ordering(rows: readonly Example[], value: (r: Example) => number): number | null {
  const pos = rows.filter((r) => (GATED.hand as readonly LabelGroup[]).includes(r.group)).map(value);
  const neg = rows.filter((r) => r.group === 'not').map(value);
  if (pos.length === 0 || neg.length === 0) return null;
  let wins = 0;
  for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

export const passesAt = (fit: ScoreFit | null, bar: number | null) => (r: Example): boolean =>
  r.rulesPass && (bar === null || fit === null || postRankScore(r.signals, fit) >= bar);

const share = (r: Rate): number | null => (r.tested === 0 ? null : r.passed / r.tested);

/** Whether `next` is no worse than `ref` on the held-out posts; the first reason it is, otherwise. */
export function gateFit(heldOut: readonly Example[], next: ScoreFit, ref: ScoreFit | null, bar: number | null): { readonly apply: boolean; readonly why: string | null; readonly next: ReturnType<typeof ratesOf>; readonly ref: ReturnType<typeof ratesOf>; readonly order: number | null; readonly refOrder: number | null } {
  const n = ratesOf(heldOut, passesAt(next, bar));
  const r = ratesOf(heldOut, passesAt(ref, bar));
  const order = ordering(heldOut, (e) => postRankScore(e.signals, next));
  const refOrder = ordering(heldOut, (e) => (ref === null ? (e.rulesPass ? 1 : 0) : postRankScore(e.signals, ref)));
  const worse = (a: Rate, b: Rate, lowerIsBetter = false): boolean => {
    const x = share(a);
    const y = share(b);
    return x !== null && y !== null && (lowerIsBetter ? x > y : x < y);
  };
  const ofN = (x: Rate) => `${x.passed}/${x.tested}`;
  const vs = ref === null ? "with today's rules" : 'with the fit in use';
  let why: string | null = null;
  if (order === null || refOrder === null) why = 'nothing to test on: the held-out posts need a gated positive and a non-meme with stored facts';
  else if (worse(n.hand, r.hand)) why = `hand gold ${ofN(n.hand)}, against ${ofN(r.hand)} ${vs}`;
  else if (worse(n.negatives, r.negatives, true)) why = `live non-memes ${ofN(n.negatives)}, against ${ofN(r.negatives)} ${vs}`;
  else if (worse(n.missed, r.missed)) why = `missed ${ofN(n.missed)}, against ${ofN(r.missed)} ${vs}`;
  else if (order < refOrder) why = `held-out gold is put above a non-meme ${pct(order)} of the time, against ${pct(refOrder)} ${vs}`;
  return { apply: why === null, why, next: n, ref: r, order, refOrder };
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** Each signal's weight per standard deviation (its value term), and its missing term, largest first. */
export function signalWeights(fit: ScoreFit): readonly { readonly signal: string; readonly weight: number; readonly missing: number | null }[] {
  const by = new Map<string, { weight: number; missing: number | null }>();
  for (const t of fit.terms) {
    const e = by.get(t.signal) ?? { weight: 0, missing: null };
    if (t.kind === 'value') e.weight = t.weight;
    else e.missing = t.weight;
    by.set(t.signal, e);
  }
  return [...by.entries()].map(([signal, e]) => ({ signal, weight: round(e.weight), missing: e.missing === null ? null : round(e.missing) })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight) || a.signal.localeCompare(b.signal));
}
const round = (x: number): number => Math.round(x * 100) / 100;

/** A labelled post the fit may use: one with a measured reach reading, as every For You post has. */
export const usable = (e: Example): boolean => e.signals.reach !== null;

/* ── the owner's trade-off table ──────────────────────────────────────────────────────────────── */

/** Folds for the cross-validated table. */
export const TABLE_FOLDS = 5;

/**
 * Every row scored by a fit that never saw it: `folds` folds by the id's hash, each scored by a fit
 * on the others. For the owner's table only, so it can use every label (the fixed held-out share
 * alone may hold three positives); the gate stays on the fixed split.
 */
export function crossScores(rows: readonly Example[], l2: number, folds: number = TABLE_FOLDS): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (let k = 0; k < folds; k++) {
    const test = rows.filter((r) => foldOf(r.itemId, folds) === k);
    if (test.length === 0) continue;
    const fit = fitLogistic(rows.filter((r) => foldOf(r.itemId, folds) !== k), l2);
    for (const r of test) out.set(r.itemId, postRankScore(r.signals, fit));
  }
  return out;
}

/** For each bar: each group passed-of-tested with today's rules and the bar together, and with the bar alone. */
export function tradeOff(rows: readonly Example[], value: (r: Example) => number, bars: readonly number[] = TABLE_BARS) {
  return bars.map((bar) => ({
    bar,
    withRules: ratesOf(rows, (r) => r.rulesPass && value(r) >= bar),
    alone: ratesOf(rows, (r) => value(r) >= bar),
  }));
}
