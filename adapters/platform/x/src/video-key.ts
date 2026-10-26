/**
 * THE UPLOADED VIDEO BEHIND A POST ON X: the id the platform gives one uploaded video, read from
 * the address of its thumbnail (`…/amplify_video_thumb/<id>/…`, `ext_tw_video_thumb`,
 * `tweet_video_thumb`). Every post that re-uses the upload carries the same id, whatever its words.
 *
 * Why it exists (the owner, 2026-10-26, the H2O monkey): six posts of one video in Portuguese,
 * Turkish and Spanish, 3.4M views, were never one narrative — a video post has no picture vector,
 * so "the same picture" never held, and the captions' languages pulled the words apart. The upload's
 * id is exact and free: the narratives join posts that share it (Policy.narrative.sameVideo).
 *
 * Here, in the X adapter, because the address's shape is this platform's; the runner reads it
 * through the registry. What breaks if changed carelessly: matching any number in the path. The
 * profile and media folders carry ids too, and two posts with the same account picture are not one video.
 */

const THUMB = /\/(?:amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\/(\d{6,25})\//;

/** The upload id of a post's first video, from its stored media; null when it has none we can read. */
export function videoKeyOf(media: unknown): string | null {
  if (!Array.isArray(media)) return null;
  for (const m of media) {
    if (m === null || typeof m !== 'object') continue;
    const uri = (m as Record<string, unknown>)['uri'];
    if (typeof uri !== 'string') continue;
    const hit = THUMB.exec(uri);
    if (hit !== null) return `x-video:${hit[1]}`;
  }
  return null;
}
