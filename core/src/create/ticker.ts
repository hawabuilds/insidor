/**
 * Whether a ticker is free to launch under: the rule behind the Create screen's
 * "You'd be first".
 *
 * Its own file because it is the one place a launch is judged rather than a story, and
 * because the answer is a claim about the world that a person acts on with money: it has to
 * be possible to say "we cannot tell" and never be made to pick.
 *
 * ★ THREE ANSWERS, NOT TWO.
 *   taken    we saw at least one launch under it in the lookback. The count is a fact.
 *   unseen   we watched almost all of the lookback and saw none. The screen may say
 *            "You'd be first" — first that we saw, which the coverage bar is what earns.
 *   unknown  our launch watch has not covered enough of the lookback to say. Finding
 *            nothing in hours we did not watch is not evidence nobody launched.
 *
 * Folding `unknown` into `unseen` is the failure this exists to stop: a watcher that was
 * down for a day would tell every user they were first.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import type { Millis } from '@insidor/contracts/vocabulary.ts';

export type TickerUse =
  | { readonly kind: 'taken'; readonly launches: number }
  | { readonly kind: 'unseen' }
  | { readonly kind: 'unknown' };

export interface TickerEvidence {
  /** Observed launches under this ticker within the lookback. */
  readonly launches: number;
  /** How much of the lookback our launch watch covered without a gap. */
  readonly coveredMs: Millis;
}

export function tickerUse(evidence: TickerEvidence, p: Policy): TickerUse {
  if (evidence.launches > 0) return { kind: 'taken', launches: evidence.launches };
  const share = evidence.coveredMs / p.assets.tickerLookbackMs;
  return share >= p.assets.tickerMinCoverage ? { kind: 'unseen' } : { kind: 'unknown' };
}
