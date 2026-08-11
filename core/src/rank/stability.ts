/**
 * The metric nobody instruments and everybody should: rank correlation between
 * consecutive ticks.
 *
 * It has a floor AND a ceiling, which is what makes it useful. Below the floor the
 * board is churning and unreadable. Sustained near one, the board is frozen — which
 * looks stable and means the ranker has stopped responding to anything. Only a
 * two-sided metric can tell those apart, and neither is visible in a screenshot.
 */

import { notImplemented } from '../not-implemented.ts';

/**
 * TO BUILD: Kendall tau between two orderings of the same subject ids, handling the
 * entering and leaving sets rather than assuming the two lists match.
 */
export function kendallTau(_previous: readonly string[], _next: readonly string[]): number {
  return notImplemented('rank/stability.ts: Kendall tau between consecutive ticks');
}
