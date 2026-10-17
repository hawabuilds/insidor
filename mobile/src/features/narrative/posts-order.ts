/**
 * THE NARRATIVE PAGE'S POSTS, AS DECISIONS (the owner, 2026-10-17: "the narrative page shows the
 * whole story, not just 24h"): which post is pinned as "First post we caught", the order of the
 * rest, and how many are drawn before the next screenful. Apart from NarrativePage.tsx so
 * `node --test` holds the rules.
 *
 *   First post we caught   the post we FOUND first (the server's per-post `foundAt`, the save time
 *                          of item.first_seen_at) among the posts the page lists now — so when the
 *                          owner removes it, the next earliest takes its place at the next frame.
 *                          Not the earliest posted: a post can go up days before we see it. No post
 *                          with a found time (an older server): nothing is pinned, never a guess
 *   All posts              every other post the page lists, since the first, newest posted first;
 *                          a post with no posted time goes last
 *   Screenful              `PAGE` rows, and `PAGE` more each time the list's end comes into view
 *
 * What breaks if changed carelessly: pinning by posted time would show a post we never caught
 * first as "the first post we caught" — the one claim on this card.
 */

import type { Evidence, Story } from '../../shared/api/index.ts';

/** Rows drawn at first, and added each time the end of the list is reached. */
export const PAGE = 20;

/** The pinned post and when we found it, or null when no post has a found time. */
export function firstCaught(story: Story): { readonly post: Evidence; readonly foundAt: number } | null {
  let best: { post: Evidence; foundAt: number } | null = null;
  for (const e of story.evidence) {
    const f = story.postViews?.get(e.evidenceId)?.foundAt ?? null;
    if (f === null) continue;
    if (best === null || f < best.foundAt || (f === best.foundAt && e.evidenceId < best.post.evidenceId)) best = { post: e, foundAt: f };
  }
  return best;
}

/** Every listed post but `pinned`, newest posted first; unknown posted times last, in the page's order. */
export function newestFirst(story: Story, pinned: string | null): readonly Evidence[] {
  const rest = story.evidence.filter((e) => e.evidenceId !== pinned);
  const known = rest.filter((e) => e.postedAt.known);
  const unknown = rest.filter((e) => !e.postedAt.known);
  const at = (e: Evidence) => (e.postedAt.known ? e.postedAt.at : 0);
  return [...known].sort((a, b) => at(b) - at(a)).concat(unknown);
}
