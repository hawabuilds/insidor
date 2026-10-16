/**
 * WHICH ON-SCREEN POSTS ARE STILL WORTH A PAID RE-READ.
 *
 * `PgItemRepo.trackable` hands TRACK the posts on a feed, the members of promoted stories, the
 * catch-all posts the judge has answered, and young catch-all posts that are growing fast.
 * Some of those can never be shown again whatever their views do, and a re-read of one buys a
 * number nobody will see. This drops them before TRACK decides anything; it never adds a post.
 *
 * Read:
 *   - every post on For You or Popular now (public.rising_row): what is on screen;
 *   - a post the judge passed, or said "yes" to just under its bar — the picture boost can
 *     still put that one on For You (core's `couldPassWithBoost`), and either may yet clear For
 *     You's reach bar, which only a re-read can show;
 *   - a post not judged yet, when a catch-all lane found it (its reach decides whether it is
 *     judged at all) or it sits in a narrative the board shows.
 * Skipped:
 *   - a post past `track.offFeedMaxAgeMs` from a paid-read source that is on neither For You nor
 *     Popular's live frame (`offFeedTooOld`, below) — whatever else would keep it;
 *   - a post whose newest judgement fails core's per-post rule even with the best picture match
 *     there could be — any "no", a broken name test, a "yes" too far under the bar. A
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
import { couldPassWithBoost, postScoreReason } from '@insidor/core';
import type { TrackingFacts, TrackingJudgement } from '@insidor/store';

/** Whether this answer could still put the post on a feed, given the luckiest picture match. */
export function couldStillPass(j: TrackingJudgement, policy: Policy): boolean {
  return couldPassWithBoost(j, policy);
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

/**
 * ★ THE STALE CUT (`feed.fresh.cutStale`, off by default): a post older than `fresh.staleAfterMs`
 * that has not passed the bar (never judged) and is on no feed is not re-read. It is in TRACK only
 * as a member of a promoted narrative, and measured over 2026-10-13 such posts almost never pass:
 * 51 were re-read past six hours, 795 reads, and none reached For You. A post with no time is
 * not shown to be old, so it is kept.
 */
export function staleUnpassed(itemId: string, postedAt: number | null, now: number, facts: TrackingFacts, policy: Policy): boolean {
  const f = policy.feed.fresh;
  if (!f.cutStale || postedAt === null) return false;
  if (now - postedAt <= f.staleAfterMs) return false;
  return !facts.judged.has(itemId) && !facts.onFeed.has(itemId);
}

/** The sources the off-feed cut applies to: the two whose re-reads are paid per post or per run. */
const OFF_FEED_CUT_SOURCES: ReadonlySet<string> = new Set(['x', 'tiktok']);

/**
 * ★ THE OFF-FEED CUT (`track.offFeedMaxAgeMs`, the owner's rule of 2026-10-16): a post from one of
 * the paid-read sources, older than the limit by its post time, that is not on For You (its live
 * frame or its scroll), is not re-read. It overrides every reason above to keep a post, because
 * past that age the six-hour rule keeps a new post off For You and a passing post's reads buy
 * a number no one is shown. A post with no time is not shown to be old, so it is kept.
 *
 * A post in Popular's live frame is kept too: its views are on screen now, and a frozen count
 * there would be shown as current. Measured 2026-10-16 that is about 9 reads a day.
 */
export function offFeedTooOld(itemId: string, source: string, postedAt: number | null, now: number, facts: TrackingFacts, policy: Policy): boolean {
  if (!OFF_FEED_CUT_SOURCES.has(source) || postedAt === null) return false;
  if (now - postedAt <= policy.track.offFeedMaxAgeMs) return false;
  return !facts.onForYou.has(itemId) && !facts.onFeed.has(itemId);
}
