/**
 * WHICH SIZE OF A PICTURE THE JUDGE IS SHOWN — the one place that knows a picture host's own
 * size names.
 *
 * The judge pays for a picture by its area: the vendor bills roughly width × height / 750
 * tokens, so a 1200×1200 post picture is ~1,500 input tokens, about as much as the whole fixed
 * prompt. The host most of our pictures come from (pbs.twimg.com, both post media and video
 * preview stills) serves the same picture at named sizes from a query parameter: `name=small`
 * fits it in 680×680 (~600 tokens for a square), `name=360x360` in 360×360 (~170). Asking for
 * a named size costs nothing and needs no image library; resizing bytes ourselves would.
 *
 * Separate from client.ts because it is a fact about a picture HOST, not about the judge's
 * vendor, and it is the part most likely to change under us.
 *
 * ★ A SMALLER PICTURE CAN CHANGE THE ANSWER. Whether a cut is worth it is measured with
 * tools/feed-pass-rates.ts on the gold and non-meme posts before it is switched on; it is OFF
 * unless a caller asks (`JudgeClientConfig.pictureSize`). Catching a coin matters more than
 * the tokens it saves.
 *
 * ★ ANY OTHER HOST IS LEFT ALONE, and a sized address that does not load falls back to the
 * original in client.ts — a size we could not get is never a picture we did not show.
 *
 * What breaks if changed carelessly: the host's `format` parameter must be set alongside
 * `name` — a video preview still ignores `name` without it (measured 2026-10-13: 960 px either
 * way), and the extension in the path is what it must say.
 */

/** The named sizes the host serves that are smaller than what the post itself links to. */
export type PictureSize = 'small' | '360x360';

const SIZED_HOST = 'pbs.twimg.com';
const FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp']);

/** The address of `uri` at `size`, or `uri` itself when its host has no named sizes. */
export function sizedPictureUri(uri: string, size: PictureSize): string {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return uri;
  }
  if (url.hostname !== SIZED_HOST) return uri;
  const ext = /\.([a-z]+)$/i.exec(url.pathname)?.[1]?.toLowerCase();
  const format = url.searchParams.get('format') ?? (ext !== undefined && FORMATS.has(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : null);
  if (format === null) return uri;
  url.searchParams.set('format', format);
  url.searchParams.set('name', size);
  return url.toString();
}
