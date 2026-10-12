/**
 * When a post was made, read from its id — no request.
 *
 * This source's post ids carry the post's Unix time in their top 32 bits. That makes "was
 * this post made before the coin?" answerable from a link alone, which the coin-origin checks
 * and the gold set ask of every origin post.
 *
 * What breaks if changed carelessly: an id whose top bits give a time before the source
 * existed (2016) is not one of these ids, and is refused (null) rather than dated wrongly.
 */

const FIRST_POST_MS = Date.UTC(2016, 8, 1);

/**
 * A pasted link on this source: a post and its id, an account, or null when the link is not
 * this source's — or is a share link, whose id is only known after a request (short-link.ts).
 */
export function parseLink(url: string): { readonly kind: 'post'; readonly sourceItemId: string } | { readonly kind: 'account' } | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (!/^(?:www\.|m\.)?tiktok\.com$/i.test(u.hostname)) return null;
  const post = /^\/@[^/]+\/(?:video|photo)\/(\d+)/.exec(u.pathname)?.[1];
  if (post !== undefined) return { kind: 'post', sourceItemId: post };
  return /^\/@[^/]+\/?$/.test(u.pathname) ? { kind: 'account' } : null;
}

export function postTimeFromId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  const ms = Number(BigInt(id) >> 32n) * 1_000;
  return ms < FIRST_POST_MS ? null : ms;
}
