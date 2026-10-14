/**
 * A card's picture at the size the card draws it, not the size it was posted at (the owner,
 * 2026-10-14: no lag after 500 cards on an iPhone). A post's picture can arrive at 1200 to 4000
 * pixels across for an 84-pixel box; decoding that on a phone for every card is what makes a long
 * list stutter. The post picture host serves the same picture at a named size, so the card asks
 * for one that fits a 360-pixel square — a little over the box at three device pixels per point.
 *
 * Only that host's own picture paths are rewritten, and only when the link does not already name
 * a size; every other link (a short-video cover is already small) is used as it came. Pure, so the
 * rewrite is tested (picture-size.test.ts). What breaks if changed carelessly: a size the host
 * does not know is answered with the full picture, silently, so the saving disappears unnoticed.
 */

const PICTURE_HOST = 'pbs.twimg.com';
const CARD_SIZE = '360x360';

export function cardPictureUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.hostname !== PICTURE_HOST || u.searchParams.has('name')) return url;
  const m = /^(.*)\.(jpe?g|png|webp)$/i.exec(u.pathname);
  if (m === null) return url;
  u.pathname = m[1] ?? u.pathname;
  u.searchParams.set('format', (m[2] ?? 'jpg').toLowerCase());
  u.searchParams.set('name', CARD_SIZE);
  return u.toString();
}
