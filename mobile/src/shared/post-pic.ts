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

/** One picture as a reply names it: the source's link and our copy's file name, either may be missing. */
export interface PictureRef {
  readonly url: string | null;
  readonly file: string | null;
}

/**
 * A signed link the source has said is past its end: the short-video host writes the end into the
 * link (`x-expires`, seconds) and answers 403 after it. Such a link is not tried at all, so a box
 * whose picture has run out moves to its next picture at once instead of after a failed request.
 * A link that names no end is never judged expired.
 */
export function linkExpired(url: string, nowMs: number): boolean {
  const m = /[?&]x-expires=(\d{9,11})(?:&|$)/.exec(url);
  return m !== null && Number(m[1]) * 1000 <= nowMs;
}

/**
 * A narrative's picture and then its posts' pictures, in order, for a box that must show the
 * narrative (the token page's narrative card). The narrative's own picture IS one of its posts'
 * pictures (its lead post's), so a later post's picture is the same narrative's, not a borrowed
 * one. Each keeps our copy (`file`); an expired link is dropped but its copy kept; the same
 * picture twice is tried once; at most `limit` pictures, so a narrative of 250 posts whose
 * pictures all fail costs a few requests, not 250.
 */
export function storyPictures(own: PictureRef, posts: readonly PictureRef[], nowMs: number, limit = 4): readonly PictureRef[] {
  const seen = new Set<string>();
  const out: PictureRef[] = [];
  for (const p of [own, ...posts]) {
    const url = p.url !== null && !linkExpired(p.url, nowMs) ? p.url : null;
    const file = postPicFile(p.file);
    if (url === null && file === null) continue;
    const key = `${file ?? ''}|${url ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url, file });
    if (out.length >= limit) break;
  }
  return out;
}
