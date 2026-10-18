/**
 * THE NARRATIVE PAGE'S POSTS, AS DECISIONS (the owner, 2026-10-17: "the narrative page shows the
 * whole story, not just 24h"; 2026-10-18: "show both moments honestly"): which post is pinned as the
 * story's first post, the page's two moments, the order of the rest, and how many are drawn before
 * the next screenful. Apart from NarrativePage.tsx so `node --test` holds the rules.
 *
 *   First post     the post that WENT UP first among the posts the page lists now (its site's own
 *                  posted time), even when we found it later than others: the earliest post we
 *                  know of. Removing it pins the next earliest at the next frame. No listed post
 *                  with a posted time: nothing is pinned and the moment is a dash with its reason
 *   We found it    the earliest moment we saved ANY post the page lists (the server's `foundAt`,
 *                  item.first_seen_at): the story's, not the pinned post's. Unknown: a dash
 *   All posts      every other post the page lists, newest posted first; a post with no posted
 *                  time goes last
 *   Screenful      `PAGE` rows, and `PAGE` more each time the list's end comes into view
 *
 * What breaks if changed carelessly: the two moments are two different facts. Until 2026-10-18 the
 * card pinned the post we found first and called it "First post we caught"; on the Tesla Roadster
 * page that was a Friday post while the story's posts went back to Wednesday. A post found first is
 * not a post posted first, and the page now says each for what it is.
 */

import type { Evidence, Story } from '../../shared/api/index.ts';

/** Rows drawn at first, and added each time the end of the list is reached. */
export const PAGE = 20;

/** The post that went up first, and when; null when no listed post has a posted time. */
export function firstPosted(story: Story): { readonly post: Evidence; readonly postedAt: number } | null {
  let best: { post: Evidence; postedAt: number } | null = null;
  for (const e of story.evidence) {
    if (!e.postedAt.known) continue;
    const at = e.postedAt.at;
    if (best === null || at < best.postedAt || (at === best.postedAt && e.evidenceId < best.post.evidenceId)) best = { post: e, postedAt: at };
  }
  return best;
}

/** The page's two moments, each a time or a dash with its reason. */
export type Moment = { readonly known: true; readonly at: number } | { readonly known: false; readonly why: string };

export function moments(story: Story): { readonly firstPost: Moment; readonly found: Moment } {
  const first = firstPosted(story);
  return {
    firstPost: first !== null ? { known: true, at: first.postedAt } : { known: false, why: story.evidence.length === 0 ? 'no posts listed' : 'the sites gave no post times' },
    found: story.foundAt?.known === true ? { known: true, at: story.foundAt.at } : { known: false, why: 'not recorded for this narrative' },
  };
}

/** Every listed post but `pinned`, newest posted first; unknown posted times last, in the page's order. */
export function newestFirst(story: Story, pinned: string | null): readonly Evidence[] {
  const rest = story.evidence.filter((e) => e.evidenceId !== pinned);
  const known = rest.filter((e) => e.postedAt.known);
  const unknown = rest.filter((e) => !e.postedAt.known);
  const at = (e: Evidence) => (e.postedAt.known ? e.postedAt.at : 0);
  return [...known].sort((a, b) => at(b) - at(a)).concat(unknown);
}
