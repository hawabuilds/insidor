/**
 * A narrative's stage on the board — Early, Forming or Big — from two counts a reader can check:
 * the posts the board lists for it and the views of its most-viewed post.
 *
 * Its own file because project.ts (which puts the stage on the story page) and narrative-rules.ts
 * (which decides which posts are listed) would otherwise import each other.
 *
 * What breaks if changed carelessly: the stage must stay a pure function of those two counts and
 * `policy.rising.narrativeStages`. Folding in anything we infer — a judge's confidence, a growth
 * rate we fitted — would turn a name for a count into a score shown on screen.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

/** What the board calls a narrative's size: a name for two counts, nothing more. */
export type NarrativeStage = 'early' | 'forming' | 'big';

/**
 * ★ THE STAGE, FROM FACTS ONLY: the posts the board lists for the narrative and the views of its
 * most-viewed post (`policy.rising.narrativeStages`). Unread views are not zero and not big: a
 * narrative whose views nobody read is staged on its post count alone.
 */
export function narrativeStage(listedPosts: number, topReach: number | null, policy: Policy): NarrativeStage {
  const bars = policy.rising.narrativeStages;
  if (listedPosts >= bars.bigMinPosts) return 'big';
  if (listedPosts < bars.formingMinPosts) return 'early';
  return topReach !== null && topReach >= bars.bigMinReach ? 'big' : 'forming';
}
