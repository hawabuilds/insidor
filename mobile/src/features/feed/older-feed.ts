/**
 * FOR YOU AND POPULAR WITHOUT END — the rule for putting the infinite scroll's pages under the
 * frame (the owner, 2026-10-14: "FYP shows every post that ever made it, newest first ... no Load
 * more button"). Pure, so it is tested (older-feed.test.ts); useOlderPosts.ts does the reading.
 *
 * ★ THE FRAME FIRST, THEN THE PAGES, EACH POST ONCE. The frame (`GET /rising/:feed`, kept live by
 * useLiveFeed.ts) is the top of the list, and new posts still slide in above it. The pages
 * (`GET /rising/:feed/older`) are every post that was on the feed, appended under it as they
 * arrive. A post can be in both for a moment (it left the frame between two reads): it is shown
 * once, where it already is, so nothing on screen moves.
 *
 * ★ FOR YOU IS ONE ORDER, NEWEST POSTED FIRST (the owner, 2026-10-17). Its first page is asked for
 * under the frame's last card (useOlderPosts.ts `after`), so a page is normally all older than the
 * frame; and the pieces are joined by their order (feed-order.ts), so even a page read after the
 * list changed puts each card at its time, never below an older one. Popular's pages go by when
 * each post joined and its frame by views, so its pages are simply appended.
 *
 * What breaks if changed carelessly: putting a page's post above one already shown out of its
 * order, or showing a post twice, both move cards under a thumb.
 */

import type { RisingPost } from '../../shared/api/index.ts';
import { mergeInOrder, type Order } from './feed-order.ts';

/** How many cards before the end the next page is asked for. */
export const PREFETCH_ROWS = 10;

/** The frame, then every older post not already above it: by `order` when given, else appended. */
export function withOlder(head: readonly RisingPost[], older: readonly RisingPost[], order: Order<RisingPost> | null = null): readonly RisingPost[] {
  if (older.length === 0) return head;
  return appendPage(head, older, order);
}

/** A page added to the posts held: only posts not held yet, by `order` when given, else in the page's order at the end. */
export function appendPage(held: readonly RisingPost[], page: readonly RisingPost[], order: Order<RisingPost> | null = null): readonly RisingPost[] {
  if (order !== null) return mergeInOrder(held, page, order, { unplaced: 'end' });
  const seen = new Set(held.map((p) => p.id));
  const out = [...held];
  for (const p of page) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}
