/**
 * THE RECALL MODEL: given a post and today's discovery settings, would a catch-all lane have
 * returned it, and how many minutes after it was posted?
 *
 * ★ THE FUNCTIONS LIVE IN CORE NOW (core/src/sources/recall.ts) and are re-exported below; this
 * file keeps the reason list and the report's helpers. Used three times: the gold set's recall
 * report (eval/src/gold/run-recall.ts), which asks it of every founder-labelled origin post, and the daily check (tools/recall-check.ts), which asks it only to
 * NAME the reason for a post we did not have, and the owner's missed posts (core/src/learning/
 * missed.ts), named the same way. The daily check's caught/not-caught is never the
 * model's — it is what public.item held — so the model can only be wrong about why, never about
 * whether.
 *
 * ── HOW A LANE CATCHES A POST ─────────────────────────────────────────────
 *
 * A lane asks, every `everyMin`, for posts newer than its window that already carry `floor`
 * approvals, newest first, a capped number of results. So a post is caught by a lane when, at a
 * pass, it is (a) a post the query matches at all — the language, not a plain repost (and not a
 * reply, when replies are left out), a picture for the media lane; (b) over the floor; and (c) still young enough that
 * the lane reaches back to it. (c) is `reachMin`, MEASURED from the ages at which the lane really
 * found its posts, not the window it asked for: a lane whose result cap fills before the window
 * ends reaches only as far back as its last result (store/src/repo/recall.ts says why).
 *
 * ── THE ASSUMPTION EVERYTHING HERE RESTS ON ───────────────────────────────
 *
 * We do not have a post's approval history, only its count when we read it. So approvals are
 * assumed to grow as `final × (1 − e^(−age/τ))`, with τ fitted to our own readings of live posts
 * (`fitGrowthTau`), and the count read now is taken as `final`. Then the age at which a post
 * crossed a floor is `−τ·ln(1 − floor/final)`, and the first pass after that is, on average, half
 * a pass later. A post that grew slower than τ says (most viral posts keep growing for days) is
 * credited too early here — the report reruns at a slower τ to show how much that moves.
 *
 * What breaks if changed carelessly: MISS_REASONS is also the CHECK list of 0047; the test beside
 * this file keeps them equal. And the reason ORDER in `classify` is the claim: a post not in the
 * search is that before it is anything else, because no floor or cadence would have changed it.
 */

/** Why a post was not caught. The first three say the question could not be asked of X at all. */
export const MISS_REASONS = [
  'not_on_x',
  'launch_unknown',
  'posted_after_launch',
  'discovery_off',
  'deleted',
  'not_in_search',
  'under_floor',
  'between_checks',
  'post_unread',
] as const;
export type MissReason = (typeof MISS_REASONS)[number];

/* The model itself is core's (core/src/sources/recall.ts): the runner diagnoses the owner's missed
   posts with it, and a service may import core but not eval. Re-exported here so every caller of
   this file, and its test, read the one copy. */
export { approvalsAt, crossingAgeMin, fitGrowthTau, inSearch, missReasonBefore, searchFilter, verdict } from '@insidor/core';
export type { DiscoverySettings, LaneSetting, RecallPostFacts as PostFacts, Verdict } from '@insidor/core';

/** The median of a list, or null when it is empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}
