/**
 * WHICH ON-SCREEN POSTS ARE STILL WORTH A PAID RE-READ.
 *
 * `PgItemRepo.trackable` hands TRACK the posts on a feed and the members of promoted stories.
 * Some of those can never be shown again whatever their views do, and a re-read of one buys a
 * number nobody will see. This drops them before TRACK decides anything; it never adds a post.
 *
 * Read:
 *   - every post on For You or Popular now (public.rising_row): what is on screen;
 *   - a post the judge passed, or turned down UNSURELY — the picture boost can still put an
 *     unsure "no" on For You, and either may yet clear For You's reach bar, which only a
 *     re-read can show;
 *   - a post not judged yet, when a catch-all lane found it (its reach decides whether it is
 *     judged at all) or it sits in a narrative the board shows.
 * Skipped:
 *   - a post whose newest judgement fails core's per-post rule even with the best picture match
 *     there could be — a firm "no", a broken name test, a "yes" under the confidence bar. A
 *     post is judged once, so that answer is final until someone re-scores it, and then this
 *     follows the new answer on the next pass;
 *   - a post not judged and not catch-all whose only narratives the board hides (fewer than
 *     `rising.narrativeMinPassingPosts` passing posts — the projector's own rule, narrative-
 *     rules.ts, applied the same way: no picture boost for a narrative).
 *
 * Its own file because it is a spending rule over facts the store reads, and TRACK's stage
 * (stages.ts) should not grow a second copy of the per-post rule. It calls core's
 * `postScoreReason` rather than restating it, so a change to the bar moves this with it.
 *
 * What breaks if changed carelessly: a post with no judgement must never be treated as a
 * "no" here. Skipping unscored catch-all posts would freeze their views below the reach bar,
 * so they would never be judged — and never reach the feed. That is a lost post, not a saving.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import { postScoreReason } from '@insidor/core';
import type { TrackingFacts, TrackingJudgement } from '@insidor/store';

/** The closest a picture can be to another: cosine similarity tops out at one. */
const BEST_POSSIBLE_PICTURE_MATCH = 1;

/** Whether this answer could still put the post on a feed, given the luckiest picture match. */
export function couldStillPass(j: TrackingJudgement, policy: Policy): boolean {
  return postScoreReason(j, policy, BEST_POSSIBLE_PICTURE_MATCH) === 'passes';
}

/** Whether the board shows this narrative: the projector's rule, without the picture boost. */
function narrativeShown(storyId: string, facts: TrackingFacts, policy: Policy): boolean {
  const members = facts.membersOf.get(storyId) ?? [];
  const passing = members.filter((m) => {
    const j = facts.judged.get(m);
    return j !== undefined && postScoreReason(j, policy) === 'passes';
  });
  return passing.length >= policy.rising.narrativeMinPassingPosts;
}

export function worthRereading(itemId: string, facts: TrackingFacts, policy: Policy): boolean {
  if (facts.onFeed.has(itemId)) return true;
  const j = facts.judged.get(itemId);
  if (j !== undefined) return couldStillPass(j, policy);
  if (facts.catchAll.has(itemId)) return true;
  return (facts.storiesOf.get(itemId) ?? []).some((s) => narrativeShown(s, facts, policy));
}
