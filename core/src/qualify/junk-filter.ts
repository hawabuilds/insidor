/**
 * THE JUNK FILTER'S DECISION: how sure the applied fit is that a post is junk, and whether that is
 * sure enough to leave the post judge unasked (Policy.judge.junkFilter).
 *
 * Pure, and its own file, because the decision has three outcomes, not two, and the caller must not
 * collapse them: `junk` (do not ask; record that it was not asked), `ask` (the fit is not sure), and
 * `unscored` (no fit, the filter off, or no usable vector — the post is asked exactly as if the
 * filter did not exist). A missing input degrades to `unscored`, never to a guess.
 *
 * ★ THE THRESHOLD COMES WITH THE FIT. It was chosen on held-out labels when the fit was made
 * (tools/lib/junk-filter.ts), so that no hand gold or missed post would be dropped; a threshold
 * from one fit means nothing for another's weights, so it is never taken from policy.
 *
 * ★ ONE SPACE. A vector from another embedding space, or of another length, is `unscored`: weights
 * fitted on one meaning say nothing about another.
 *
 * What breaks if changed carelessly: the arithmetic must stay exactly the fit's (eval
 * `junkScore`): intercept plus the dot product, through the logistic. The probability decides and
 * never leaves the runner; no number from here reaches a screen.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { logistic } from '../math.ts';

/** An applied fit, as the runner holds it. */
export interface JunkFit {
  readonly id: number;
  readonly space: string;
  readonly intercept: number;
  readonly weights: readonly number[];
  readonly threshold: number;
}

export type JunkVerdict =
  | { readonly kind: 'junk'; readonly probability: number; readonly fitId: number }
  | { readonly kind: 'ask'; readonly probability: number; readonly fitId: number }
  | { readonly kind: 'unscored'; readonly why: 'off' | 'no_fit' | 'no_vector' | 'other_space' };

/** The fit's probability that a vector is junk; null when the vector cannot be scored by it. */
export function junkProbability(values: ArrayLike<number>, space: string, fit: JunkFit): number | null {
  if (space !== fit.space || values.length !== fit.weights.length || values.length === 0) return null;
  let z = fit.intercept;
  for (let j = 0; j < values.length; j++) z += (fit.weights[j] as number) * (values[j] as number);
  return Number.isFinite(z) ? logistic(z) : null;
}

/** Whether to leave the judge unasked about one post. */
export function junkVerdict(vector: { readonly values: ArrayLike<number>; readonly space: string } | null, fit: JunkFit | null, p: Policy): JunkVerdict {
  if (!p.judge.junkFilter.on) return { kind: 'unscored', why: 'off' };
  if (fit === null) return { kind: 'unscored', why: 'no_fit' };
  if (vector === null) return { kind: 'unscored', why: 'no_vector' };
  const probability = junkProbability(vector.values, vector.space, fit);
  if (probability === null) return { kind: 'unscored', why: 'other_space' };
  return probability >= fit.threshold ? { kind: 'junk', probability, fitId: fit.id } : { kind: 'ask', probability, fitId: fit.id };
}
