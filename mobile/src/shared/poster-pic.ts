/**
 * Where a poster's profile picture is loaded from, in order: our storage's copy, then the
 * source's own link, then (when both fail) the caller draws the handle's letter. Apart from the
 * components so `node --test` holds the order and the path.
 *
 * ★ OUR COPY FIRST, BECAUSE THE SOURCE'S LINK EXPIRES. The short-video source signs its picture
 * links for about a day, so every older card in the infinite scroll lost its face on every phone.
 * The server copies each feed poster's picture into storage (services/project/src/poster-pics.ts)
 * and sends only the copy's file name (`authorPictureFile`); the path is built here, as a coin
 * logo's is from its address, because the app's censor refuses the storage vendor's name inside
 * any value a reply carries.
 *
 * The base is `VITE_POSTER_PIC_BASE` when set, else the coin-logo base with its folder swapped:
 * both folders sit in the same public bucket, so a deployment that shows copied logos shows copied
 * faces with no new setting. Neither set, the copy is skipped and the link is used as before.
 *
 * What breaks if changed carelessly: the folder must match `POSTER_PIC_FOLDER` in
 * adapters/storage/supabase/src/poster-pic.ts, and a file name is taken only as 32 hex characters,
 * so nothing a reply carries can steer the path elsewhere in the bucket.
 */

const FILE = /^[0-9a-f]{32}$/;

/** The folder of copied faces, from the two settings; '' when neither is set. */
export function posterPicBase(posterBase: string | undefined, coinLogoBase: string | undefined): string {
  const own = (posterBase ?? '').trim().replace(/\/+$/, '');
  if (own !== '') return own;
  const logos = (coinLogoBase ?? '').trim().replace(/\/+$/, '');
  return /\/coin-logos$/.test(logos) ? logos.replace(/\/coin-logos$/, '/author-pics') : '';
}

/** The pictures to try, in order; empty when there is nothing to load (the letter shows). */
export function posterPicSources(file: string | null, link: string | null, base: string): readonly string[] {
  const out: string[] = [];
  if (base !== '' && file !== null && FILE.test(file)) out.push(`${base}/${file}`);
  if (link !== null && link.startsWith('https://')) out.push(link);
  return out;
}

/** A copy's file name as the reply carried it; null for anything that is not one. */
export function posterPicFile(v: unknown): string | null {
  return typeof v === 'string' && FILE.test(v) ? v : null;
}
