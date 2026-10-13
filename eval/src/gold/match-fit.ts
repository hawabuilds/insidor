/**
 * FITTING THE COIN-MATCHING WEIGHTS: the ranking's weights learned from posts whose right coin is
 * known, so "likely" means what the labelled posts say it means.
 *
 * Each labelled post is one choice among its candidates plus "none of these" (which scores 0):
 * the right coin when it is among the candidates, else "none". The fit is a conditional logit (a
 * softmax over each post's options) by plain gradient descent with a small pull toward zero,
 * deterministic, so the same labels always give the same weights. Two steps, because the two
 * questions are different and the second would drown the first:
 *   1. ORDER: every weight but `base`, on the posts whose right coin is among the candidates,
 *      without "none" — which coin of these looks most like the post's.
 *   2. HOW SURE: `base` alone, on every post, with "none" — a post whose coin no search found,
 *      or a post with no coin at all, teaches that its best candidate should NOT look likely.
 *      Most posts have no coin, so this is what keeps "likely" rare and right.
 *
 * Why its own file: the gold eval (run-matching.ts) fits on the tuning half and reports the
 * held-out half; the twice-daily re-tune (tools/lib/coin-match-fit.ts) fits on the gold set plus
 * the owner's coin labels. Both must fit the same way, or the re-tune reports a number the eval
 * never measured.
 *
 * What breaks if changed carelessly: proven coins are NOT trained on — a post a fact already
 * settled is not a choice the score makes, and fitting on it would teach the score to copy the
 * proof (a huge link weight) instead of ranking what proof cannot settle. And the weights only
 * order; they never prove. A refit can move a coin between likely and unsure, never onto a Buy.
 */

import type { PostCoinWeights } from '@insidor/contracts/policy.ts';

export type Signals = Record<keyof PostCoinWeights, number>;

/** One labelled choice: each candidate's signals, and which one was right (null: none of these). */
export interface Choice {
  readonly options: readonly Signals[];
  readonly right: number | null;
}

export interface FitOptions {
  readonly steps: number;
  readonly rate: number;
  /** The pull toward zero on every weight but the base: keeps a signal seen twice from running away. */
  readonly l2: number;
}

export const FIT: FitOptions = { steps: 3_000, rate: 0.2, l2: 0.02 };

/* The likely bar is the lowest share at which the top coin was right at least this often on the
   fitted posts: a "likely" the owner sees should be right three times in four. */
export const LIKELY_PRECISION = 0.75;
const LIKELY_BARS: readonly number[] = [0.5, 0.3, 0.2, 0.15, 0.1, 0.07, 0.05, 0.03, 0.02, 0.01];

export const SIGNAL_KEYS: readonly (keyof PostCoinWeights)[] = [
  'base', 'linksPost', 'linksAccount', 'picture', 'hash', 'description', 'authorAddress', 'othersAddress', 'timing', 'nameExact', 'nameVariant', 'tradingJump',
];

const dot = (w: Record<string, number>, s: Signals) => SIGNAL_KEYS.reduce((sum, k) => sum + (w[k] ?? 0) * s[k], 0);

const scoresOf = (w: Record<string, number>, c: Choice) => c.options.map((o) => dot(w, o));

/** Mean log-likelihood of the choices under the weights, "none of these" included: higher is better. */
export function logLikelihood(w: PostCoinWeights, choices: readonly Choice[]): number {
  let ll = 0;
  for (const c of choices) {
    const scores = scoresOf(w as unknown as Record<string, number>, c);
    const top = Math.max(0, ...scores);
    const z = Math.exp(-top) + scores.reduce((sum, s) => sum + Math.exp(s - top), 0);
    const chosen = c.right === null ? 0 : (scores[c.right] ?? 0);
    ll += chosen - top - Math.log(z);
  }
  return choices.length === 0 ? 0 : ll / choices.length;
}

/** Gradient descent on `keys` only; `withNone` adds the "none of these" option at 0. */
function descend(w: Record<string, number>, choices: readonly Choice[], keys: readonly (keyof PostCoinWeights)[], withNone: boolean, opt: FitOptions): void {
  if (choices.length === 0) return;
  for (let step = 0; step < opt.steps; step++) {
    const grad: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
    for (const c of choices) {
      const scores = scoresOf(w, c);
      const top = Math.max(withNone ? 0 : Number.NEGATIVE_INFINITY, ...scores);
      const ex = scores.map((s) => Math.exp(s - top));
      const z = (withNone ? Math.exp(-top) : 0) + ex.reduce((a, b) => a + b, 0);
      c.options.forEach((o, i) => {
        const p = (ex[i] ?? 0) / z;
        const target = c.right === i ? 1 : 0;
        for (const k of keys) grad[k] = (grad[k] ?? 0) + (target - p) * o[k];
      });
    }
    for (const k of keys) {
      const pull = k === 'base' ? 0 : opt.l2 * (w[k] ?? 0);
      w[k] = (w[k] ?? 0) + opt.rate * ((grad[k] ?? 0) / choices.length - pull);
    }
  }
}

/** The weights that best explain the choices, starting from `start`: the order first, then how sure. */
export function fitWeights(choices: readonly Choice[], start: PostCoinWeights, opt: FitOptions = FIT): PostCoinWeights {
  const w: Record<string, number> = { ...start };
  const found = choices.filter((c) => c.right !== null && c.options.length > 1);
  descend(w, found, SIGNAL_KEYS.filter((k) => k !== 'base'), false, opt);
  descend(w, choices, ['base'], true, opt);
  return Object.fromEntries(SIGNAL_KEYS.map((k) => [k, Math.round((w[k] ?? 0) * 1_000) / 1_000])) as unknown as PostCoinWeights;
}

/** The top option's share (against "none of these") and whether it was the right one, per choice. */
function tops(w: PostCoinWeights, choices: readonly Choice[]): readonly { readonly share: number; readonly right: boolean }[] {
  return choices.flatMap((c) => {
    const scores = scoresOf(w as unknown as Record<string, number>, c);
    if (scores.length === 0) return [];
    const best = scores.indexOf(Math.max(...scores));
    const top = Math.max(0, ...scores);
    const z = Math.exp(-top) + scores.reduce((sum, s) => sum + Math.exp(s - top), 0);
    return [{ share: Math.exp((scores[best] ?? 0) - top) / z, right: best === c.right }];
  });
}

/** The lowest likely bar whose likely coins are right at least `LIKELY_PRECISION` of the time; the highest bar when none is. */
export function pickLikelyShare(w: PostCoinWeights, choices: readonly Choice[]): { readonly share: number; readonly right: number; readonly wrong: number } {
  const t = tops(w, choices);
  let pick = { share: LIKELY_BARS[0] ?? 1, right: 0, wrong: 0 };
  for (const bar of LIKELY_BARS) {
    const named = t.filter((x) => x.share >= bar);
    const right = named.filter((x) => x.right).length;
    if (right > 0 && right / named.length >= LIKELY_PRECISION) pick = { share: bar, right, wrong: named.length - right };
  }
  return pick;
}
