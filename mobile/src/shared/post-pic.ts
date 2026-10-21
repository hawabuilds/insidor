/**
 * Where a post's picture is loaded from, in order: our storage's copy at the size the box draws,
 * then the source's links (the caller's, already in their own order), then the placeholder when
 * all fail. Apart from the components so `node --test` holds the order and the paths.
 *
 * ★ OUR COPY FIRST, BECAUSE THE SOURCE'S LINK EXPIRES. The short-video source signs its covers for
 * about a day: on 2026-10-21, 297 of the 311 short-video posts on the feeds showed the placeholder.
 * The server copies every shown post's picture into storage (services/project/src/post-pics.ts)
 * and sends only the copy's file name (`thumbFile`, the sheet's `posterFile`); the path is built
 * here, as a coin logo's is from its address, because the app's censor refuses the storage
 * vendor's name inside any value a reply carries.
 *
 * Two copies: `post-pics/<file>` (360 pixels, every list's square) and `post-pics/sheet/<file>`
 * (1080 pixels, the post sheet). The base is `VITE_POST_PIC_BASE` when set, else the coin-logo
 * base with its folder swapped: every folder sits in the same public bucket, so a deployment that
 * shows copied logos shows copied post pictures with no new setting. Neither set, the copy is
 * skipped and the links are used as before.
 *
 * What breaks if changed carelessly: the folders must match `POST_PIC_FOLDER` and
 * `POST_PIC_SHEET_FOLDER` in adapters/storage/supabase/src/post-pic.ts, and a file name is taken
 * only as 32 hex characters, so nothing a reply carries can steer the path elsewhere in the bucket.
 */

const FILE = /^[0-9a-f]{32}$/;

/** Which copy: every list's square, or the post sheet's picture. */
export type PostPicSize = 'card' | 'sheet';

/** The folder of copied post pictures, from the two settings; '' when neither is set. */
export function postPicBase(postBase: string | undefined, coinLogoBase: string | undefined): string {
  const own = (postBase ?? '').trim().replace(/\/+$/, '');
  if (own !== '') return own;
  const logos = (coinLogoBase ?? '').trim().replace(/\/+$/, '');
  return /\/coin-logos$/.test(logos) ? logos.replace(/\/coin-logos$/, '/post-pics') : '';
}

/** Our copy's address at a size, or null when there is no copy (or no storage) to try. */
export function postPicCopy(file: string | null | undefined, base: string, size: PostPicSize): string | null {
  if (base === '' || file === null || file === undefined || !FILE.test(file)) return null;
  return size === 'sheet' ? `${base}/sheet/${file}` : `${base}/${file}`;
}

/** The pictures to try, in order: our copy, then the caller's links; each once. */
export function postPicSources(file: string | null | undefined, links: readonly string[], base: string, size: PostPicSize): readonly string[] {
  const own = postPicCopy(file, base, size);
  return [...new Set([...(own === null ? [] : [own]), ...links])];
}

/** A copy's file name as the reply carried it; null for anything that is not one. */
export function postPicFile(v: unknown): string | null {
  return typeof v === 'string' && FILE.test(v) ? v : null;
}
