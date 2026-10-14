/**
 * FOR YOU AND POPULAR WITHOUT END — the rule for putting the infinite scroll's pages under the
 * frame (the owner, 2026-10-14: "FYP shows every post that ever made it, newest first ... no Load
 * more button"). Pure, so it is tested (older-feed.test.ts); useOlderPosts.ts does the reading.
 *
 * ★ THE FRAME FIRST, THEN THE PAGES, EACH POST ONCE. The frame (`GET /rising/:feed`, kept live by
 * useLiveFeed.ts) is the top of the list, in its own order, and new posts still slide in above it.
 * The pages (`GET /rising/:feed/older`) are every post that was on the feed and is not on the frame,
 * newest-joined first, appended under it as they arrive. A post can be in both for a moment (it left
 * the frame between two reads): it is shown once, where it already is, so nothing on screen moves.
 *
 * What breaks if changed carelessly: putting a page's post above one already shown, or showing a
 * post twice, both move cards under a thumb.
 */

import type { RisingPost } from '../../shared/api/index.ts';

/** How many cards before the end the next page is asked for. */
export const PREFETCH_ROWS = 10;

/** The frame, then every older post not already above it. */
export function withOlder(head: readonly RisingPost[], older: readonly RisingPost[]): readonly RisingPost[] {
  if (older.length === 0) return head;
  const seen = new Set(head.map((p) => p.id));
  const out = [...head];
  for (const p of older) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/** A page appended to the pages held: only posts not held yet, in the page's order. */
export function appendPage(held: readonly RisingPost[], page: readonly RisingPost[]): readonly RisingPost[] {
  const seen = new Set(held.map((p) => p.id));
  return [...held, ...page.filter((p) => !seen.has(p.id))];
}
