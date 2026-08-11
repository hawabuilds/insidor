/**
 * Scoring one (item, story) pair. The unit of work in GROUP is a PAIR, not an
 * arrival — which is why this stage's cost grows with the size of a candidate block
 * rather than with the number of things arriving, and why "predictions per day" is
 * the wrong way to size it.
 *
 * The six match features are the two free carrier tiers, the lineage pointer, the
 * representation similarity, source agreement and time proximity. Hand-set weights
 * today; a logistic regression over the same six once there are a few hundred
 * hand-labelled pairs, which is about three hours of work once and is the cheapest
 * model in the system.
 *
 * ONE BAR PER REPRESENTATION SPACE, NEVER SHARED. A bar calibrated on sparse term
 * geometry merges nearly everything when a dense space is dropped in behind it —
 * unrelated sentences sit well above the old constant. Policy.group.similarityBars is
 * keyed by space id for exactly that reason.
 */

import type { MatchEvidence, Story } from '@insidor/contracts/story.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { Item } from '@insidor/contracts/vocabulary.ts';

import { notImplemented } from '../not-implemented.ts';

export interface MatchResult {
  readonly story: Story;
  readonly score: number;
  readonly evidence: MatchEvidence;
}

/**
 * TO BUILD: score the pair, cheapest evidence first, and stop as soon as a free
 * carrier settles it. The paid similarity is consulted only for what the free tiers
 * missed, and its absence must degrade the score rather than block the join.
 */
export function matchScore(
  _item: Item,
  _story: Story,
  _similarityBySpace: Readonly<Record<string, number>>,
  _p: Policy,
): MatchResult {
  return notImplemented('group/match.ts: the pair score over the six match features');
}
