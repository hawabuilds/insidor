/**
 * ONE PICTURE SEARCH PER MATCHED POST A PASS: the origin check's walk back to where a matched
 * post's picture started (store `postsWithSamePicture`), asked once per post and served to every
 * coin of the pass that matched the same post.
 *
 * Why: the search compares the post's picture vector with every post vector we hold (~50,000,
 * each read from out-of-line storage): ~240,000 buffer reads and 14 s a call on 30 Oct 2026, the
 * second slowest statement on a disk-bound database. Copycat coins launched together match the same
 * viral post: in the day to 30 Oct, the coins given a post in the same minute named 874 distinct
 * posts for 1,488 coins.
 *
 * Exact, not a cache with an age: the memo lives for one pass (universe.ts makes it there), and
 * each answer is the one the store would give. The store's answer for (post, until) is the
 * earliest `limit` posts in [since, until]; the memo asks once from the pass's widest `since` (the
 * oldest coin's), keeps that list, and answers a later `since` by filtering it. Kept whole (fewer
 * than `limit` came back), any `since` inside it is answered exactly; cut at `limit`, a `since`
 * is answered from it only when at least `limit` of its posts remain, else the store is asked.
 *
 * What breaks if changed carelessly: holding the memo past one pass turns it into a cache that
 * misses posts embedded since; and filtering a list cut at `limit` without the count check
 * answers with fewer posts than the store would.
 */

import type { Millis } from '@insidor/contracts';
import type { NamingPost } from '@insidor/store';

export type SamePictureRead = (itemId: string, space: string, minSimilarity: number, sinceMs: Millis, untilMs: Millis, limit: number) => Promise<readonly NamingPost[]>;

export function samePictureMemo(read: SamePictureRead, widestSinceMs: Millis): SamePictureRead {
  const held = new Map<string, { readonly sinceMs: number; readonly whole: boolean; readonly posts: readonly NamingPost[] }>();
  return async (itemId, space, minSimilarity, sinceMs, untilMs, limit) => {
    /* A `since` older than the pass's widest was not foreseen: asked as it is. */
    if (sinceMs < widestSinceMs) return read(itemId, space, minSimilarity, sinceMs, untilMs, limit);
    const key = JSON.stringify([itemId, space, minSimilarity, untilMs, limit]);
    let h = held.get(key);
    if (h === undefined) {
      const posts = await read(itemId, space, minSimilarity, widestSinceMs, untilMs, limit);
      h = { sinceMs: widestSinceMs, whole: posts.length < limit, posts };
      held.set(key, h);
    }
    /* The store's own bound: posted in [since, until]; a post with no time is never in it. */
    const inside = h.posts.filter((p) => p.postedAt !== null && p.postedAt >= sinceMs);
    if (h.whole || inside.length >= limit) return inside.slice(0, limit);
    return read(itemId, space, minSimilarity, sinceMs, untilMs, limit);
  };
}
