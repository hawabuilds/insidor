/**
 * WHERE A COIN CAME FROM, AS A STATUS WITH ITS REASON — the coin universe's vocabulary.
 *
 * Every coin is indexed; whether a post started it is filled in over time, and each status
 * says HOW we know, never just "came from". The list is closed so a screen can be written for
 * every member, and so a status nobody reasoned about cannot be stored.
 *
 *   linked_by_creator    the creator's own link is a post, made before the coin, that started it
 *   matched_by_insidor   no usable link; our matching proved the post (picture, name, timing)
 *   found_by_team        the founders found the post by hand (the gold set)
 *   influencer_origin    the source is an influencer's or founder's statement, not a meme
 *   viral_after_launch   the post went viral, but after the coin existed. Kept, with how long
 *                        after, and ★ NEVER COUNTED AS AN ORIGIN: a coin cannot come from a post
 *                        made after it.
 *   promo_only           the only linked post is promotion (after the mint, or names the coin)
 *   account_only         the link is the coin's own profile or community, not a post
 *   unlinked             we looked and found nothing confident — a valid, honest answer
 *   not_checked_yet      we have not looked
 *
 * What breaks if changed carelessly: `isOrigin` is the one place that says which statuses name
 * a post that started the coin. A status added here and not decided there is not an origin,
 * which is the safe default.
 */

export const ORIGIN_STATUSES = [
  'linked_by_creator',
  'matched_by_insidor',
  'found_by_team',
  'influencer_origin',
  'viral_after_launch',
  'promo_only',
  'account_only',
  'unlinked',
  'not_checked_yet',
] as const;
export type OriginStatus = (typeof ORIGIN_STATUSES)[number];

/** Whether a status names the post that started the coin. */
export function isOrigin(status: OriginStatus): boolean {
  return status === 'linked_by_creator' || status === 'matched_by_insidor' || status === 'found_by_team' || status === 'influencer_origin';
}
