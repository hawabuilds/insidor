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
 * ★ AND FOR YOU'S JUNK BAR (Policy.rising.junkBar, `forYouJunkBar`): the same probability, after the
 * judge, keeps a post from joining For You at a lower bar than the skip's — chosen from the same fit's
 * held-out table so that the owner's memeable posts still pass. Here too a missing fit, bar or
 * vector lets the post through.
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

/** One row of a fit's held-out table (tools/lib/junk-filter.ts): how many of each label group it would drop at `threshold`. */
export interface HeldOutRow {
  readonly threshold: number;
  readonly dropped: Readonly<Record<string, { readonly tested: number; readonly dropped: number }>>;
}

/**
 * ★ FOR YOU'S JUNK BAR (Policy.rising.junkBar), chosen on the fit's OWN held-out table: the lowest
 * threshold at which at least `keepShare` of the owner's held-out memeable posts (`keepGroups`) are
 * under it, with at least `minTested` of them tested. Null when no row qualifies: then there is no
 * bar, never a guessed one. Each post in the table was scored by a fit made without its fold, so the
 * share is what the bar keeps of posts the fit never saw, not of the posts it was taught.
 */
export function forYouJunkBar(table: readonly HeldOutRow[], p: Policy): number | null {
  const b = p.rising.junkBar;
  const rows = [...table].filter((r) => Number.isFinite(r.threshold)).sort((x, y) => x.threshold - y.threshold);
  for (const r of rows) {
    let tested = 0;
    let dropped = 0;
    for (const g of b.keepGroups) {
      tested += r.dropped[g]?.tested ?? 0;
      dropped += r.dropped[g]?.dropped ?? 0;
    }
    if (tested >= b.minTested && tested - dropped >= b.keepShare * tested) return r.threshold;
  }
  return null;
}

/** Whether a post may join For You under the bar: no bar or no probability lets it through. */
export const underJunkBar = (probability: number | null, bar: number | null): boolean => bar === null || probability === null || probability < bar;
