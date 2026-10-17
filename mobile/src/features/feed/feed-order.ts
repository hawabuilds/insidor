/**
 * FOR YOU'S ORDER ON THE PHONE: newest posted first, one list from the frame down through every
 * page and every slide-in (the owner, 2026-10-17: "feed should be sorted new at the top old at the
 * bottom").
 *
 * The server already sends each piece in this order: the frame (services/project rising.ts
 * `forYouOrder`) and the scroll's pages (services/read feed-page.ts) by the same key — when the
 * post went up, then its id in byte order. What can still mix them is the joining on the phone: a
 * page read after the list changed, or a post that passed late sliding in. So pieces are joined
 * here by a merge of two lists already in order, never by appending: a card goes where its time
 * puts it, and the cards already shown keep their order among themselves (useLiveFeed.ts keeps the
 * one being looked at still when a card goes in above it).
 *
 * The key is the card's own age, `postedAt` — the time the card shows. A card whose posted time we
 * do not hold (it shows a dash) cannot be compared; the list already shown wins the tie, so such a
 * card stays where the server put it rather than being guessed into a place.
 *
 * Its own file because the live list (live-feed.ts) and the scroll (older-feed.ts) must join by the
 * same rule. What breaks if changed carelessly: a locale comparison of ids would disagree with the
 * server's byte order on a tie; letting the incoming list win a tie would move shown cards.
 */

import type { RisingPost } from '../../shared/api/index.ts';

/** Negative when `a` goes above `b`, positive when below; null when one has no time to compare. */
export type Order<T> = (a: T, b: T) => number | null;

/** For You's order: newer posted first, then the id in byte order, as the server sorts. */
export const newestPosted: Order<RisingPost> = (a, b) => {
  if (!a.postedAt.known || !b.postedAt.known) return null;
  return b.postedAt.at - a.postedAt.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
};

/**
 * Two lists each already in `order`, as one: every card of `shown` in its place, each card of
 * `incoming` the list does not hold yet put where the order says. A card in both stays where
 * `shown` has it (taking `incoming`'s copy when `fresh` asks), so nothing on screen jumps. A new
 * card with no time to place it by goes where it went before this order existed: `unplaced` (the
 * top for a slide-in, the end for a page).
 */
export function mergeInOrder<T extends { readonly id: string }>(
  shown: readonly T[],
  incoming: readonly T[],
  order: Order<T>,
  opts: { readonly fresh?: boolean; readonly unplaced: 'top' | 'end' },
): T[] {
  const seen = new Set(shown.map((p) => p.id));
  const newer = opts.fresh === true ? new Map(incoming.map((p) => [p.id, p] as const)) : null;
  const adds = incoming.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  /* A card compared with itself is null exactly when it has no time. */
  const placed = adds.filter((p) => order(p, p) !== null);
  const loose = adds.filter((p) => order(p, p) === null);
  const out: T[] = opts.unplaced === 'top' ? [...loose] : [];
  let j = 0;
  for (const p of shown) {
    /* A shown card with no time is passed over: the new cards wait for the next one that has one. */
    while (j < placed.length && (order(placed[j] as T, p) ?? 1) < 0) out.push(placed[j++] as T);
    out.push(newer?.get(p.id) ?? p);
  }
  while (j < placed.length) out.push(placed[j++] as T);
  if (opts.unplaced === 'end') out.push(...loose);
  return out;
}
