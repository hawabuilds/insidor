/**
 * WHICH COIN ADDRESSES WERE POSTED UNDER A POST, AND BY WHOM: the post's own account, or how many
 * other accounts.
 *
 * The coin match (post-coin.ts) proves a coin when the poster's own account posted its address
 * under the post, and weighs others posting it as a signal; it also takes every address posted
 * there as a candidate, found or not by a name search. The crypto-attention facts beside it
 * (qualify/attention.ts) count addresses; this keeps WHICH ones, so they can be matched to coins.
 *
 * Separate from attention.ts because that file's answer is counts for a feed signal the owner
 * has not wired; this one's is a list the match reads. Same address pattern (`addressesIn`) and the
 * same rule for "the post's own account" (its id, else its handle), so the two never disagree on
 * who said what.
 *
 * What breaks if changed carelessly: the post's own text counts as its author's. A post that
 * names its coin's address in its own words is the plainest "this coin is from this post" there
 * is — and also what the judge side's shill rule holds as an ad; the match records the fact and
 * leaves the hiding to that rule.
 */

import type { PostResponses } from '@insidor/contracts/ports/responses.ts';
import type { AttentionPolicy } from '@insidor/contracts/policy.ts';

import { addressesIn, type AnsweredPost } from '../qualify/attention.ts';

export interface PostedAddress {
  readonly address: string;
  /** The post's own account posted it (in the post or a reply). */
  readonly byAuthor: boolean;
  /** How many other accounts posted it. */
  readonly byOthers: number;
}

export function postedAddresses(read: PostResponses, p: AttentionPolicy, post: AnsweredPost | null = null): readonly PostedAddress[] {
  const authorId = post?.authorId ?? null;
  const handle = post?.authorHandle?.replace(/^@+/, '').toLowerCase() ?? null;
  const mine = (id: string | null, h: string | null) => (authorId !== null && id === authorId) || (handle !== null && handle !== '' && h?.toLowerCase() === handle);
  const by = new Map<string, { byAuthor: boolean; others: Set<string> }>();
  const note = (address: string, own: boolean, who: string) => {
    const e = by.get(address) ?? { byAuthor: false, others: new Set<string>() };
    if (own) e.byAuthor = true;
    else e.others.add(who);
    by.set(address, e);
  };
  for (const a of post?.text == null ? [] : addressesIn(post.text, p)) note(a, true, '');
  for (const r of [...read.replies, ...read.reproductions]) {
    const own = mine(r.authorId, r.authorHandle);
    for (const a of addressesIn(r.text, p)) note(a, own, (r.authorHandle ?? r.authorId ?? r.sourceItemId).toLowerCase());
  }
  return [...by].map(([address, e]) => ({ address, byAuthor: e.byAuthor, byOthers: e.others.size }));
}
