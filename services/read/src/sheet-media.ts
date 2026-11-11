/**
 * A POST'S MEDIA AS THE APP PLAYS IT: the one rule that turns a stored post's media list into its
 * poster, its playable file and whether it loops (a GIF) or plays as a video.
 *
 * Its own module, out of post-sheet.ts, because the post sheet, For You's cards (card-video.ts) and
 * the Narratives tab's row (narrative-rows.ts) all read it, and card-video.ts sits under
 * story-sheet.ts, which post-sheet.ts imports: kept in post-sheet.ts, the three files import each
 * other in a circle (check:boundaries refuses it).
 *
 * What breaks if changed carelessly: every surface that shows a post's media changes together; a
 * GIF read as a video gets player controls and a length it does not have.
 */

import type { Row } from './queries.ts';

const rec = (v: unknown): Row => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const https = (v: unknown): string | null => {
  const s = str(v);
  return s !== null && s.startsWith('https://') ? s : null;
};

/**
 * The post's media: its first video with a playable file, else its first picture; null when neither.
 *
 * ★ A GIF GOES OUT AS A PICTURE WITH A FILE (`kind: 'image'`, a `playUrl`, `loops: true`): a short
 * silent clip the app plays muted and looping, with no player controls, the way the source shows
 * it. A stored clip marked `loops`, or one stored before that mark with a file and no length (the
 * source gives every real video its length), is one. A real video keeps `kind: 'video'`.
 */
export function sheetMedia(raw: unknown): { readonly kind: 'video' | 'image'; readonly posterUrl: string; readonly playUrl: string | null; readonly loops: boolean; readonly width: number | null; readonly height: number | null; readonly durationMs: number | null } | null {
  const entries = (Array.isArray(raw) ? raw : []).map(rec);
  const shape = (e: Row, playUrl: string | null) => {
    const posterUrl = https(e['uri']);
    if (posterUrl === null) return null;
    const loops = playUrl !== null && (e['loops'] === true || num(e['durationMs']) === null);
    const video = !loops && (e['kind'] === 'video' || typeof e['durationMs'] === 'number');
    return { kind: video ? ('video' as const) : ('image' as const), posterUrl, playUrl, loops, width: num(e['width']), height: num(e['height']), durationMs: num(e['durationMs']) };
  };
  for (const e of entries) {
    const play = https(e['playUri']);
    if (play !== null && /\.mp4(\?|$)/i.test(play)) {
      const m = shape(e, play);
      if (m !== null) return m;
    }
  }
  for (const e of entries) {
    const m = shape(e, null);
    if (m !== null) return m;
  }
  return null;
}
