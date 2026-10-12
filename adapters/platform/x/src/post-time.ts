/**
 * When a post was made, read from its id — no request.
 *
 * This source's ids are time-ordered: the top bits are milliseconds since the source's own
 * epoch. That makes "was this post made before the coin?" answerable for a post we have only
 * a link to, which is what the coin-origin checks and the gold set ask of every origin post.
 *
 * What breaks if changed carelessly: the epoch below is this source's, fixed since 2010. Ids
 * from before then are not time-ordered and are refused (null) rather than dated wrongly.
 */

const EPOCH_MS = 1_288_834_974_657n;
/** The first time-ordered id. Anything smaller predates the scheme. */
const FIRST_ORDERED_ID = 1n << 22n;

export function postTimeFromId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  const n = BigInt(id);
  if (n < FIRST_ORDERED_ID) return null;
  return Number((n >> 22n) + EPOCH_MS);
}
