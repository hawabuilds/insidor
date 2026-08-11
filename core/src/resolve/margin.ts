/**
 * ★ THE MARGIN, which is the part that is usually missing.
 *
 * A high score on the best candidate proves nothing when candidate number two scores
 * the same. One phrase can produce hundreds of distinct assets, so "best match"
 * without "and it is separated from the next one" is a coin flip wearing a
 * confidence number. Ambiguity rejection is what makes "no confident match, no Buy
 * affordance" enforceable rather than aspirational — it is the difference between a
 * promise in a document and a branch in a function.
 *
 * There is no third verdict here on purpose. Confident, or unsure. An "almost
 * confident" band would be read by somebody, eventually, as good enough.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

export interface Separation {
  readonly best: number;
  /** null when there was exactly one candidate: nothing to be confused with. */
  readonly second: number | null;
  /** best − second, or null when there is no second. */
  readonly margin: number | null;
}

export function separation(best: number, second: number | null): Separation {
  return { best, second, margin: second === null ? null : best - second };
}

/**
 * Confident requires BOTH: over the bar, and clear of the runner-up. A single
 * candidate clears the margin test trivially — there is nothing to confuse it with —
 * but must still clear the bar.
 */
export function isConfident(s: Separation, p: Policy): boolean {
  if (s.best < p.resolve.tauHigh) return false;
  if (s.margin === null) return true;
  return s.margin >= p.resolve.deltaMargin;
}
