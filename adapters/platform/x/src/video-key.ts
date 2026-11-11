/**
 * THE UPLOADED VIDEO BEHIND A POST ON X: the id the platform gives one uploaded video, read from
 * the address of its thumbnail. Every post that re-uses the upload carries the same id, whatever
 * its words. Two shapes:
 *
 *   a video   `…/amplify_video_thumb/<number>/…` or `…/ext_tw_video_thumb/<number>/…`
 *   a GIF     `…/tweet_video_thumb/<media key>.jpg`: the key is letters and digits and is the
 *             file's own name, with no folder after it
 *
 * Why it exists (the owner, 2026-10-26, the H2O monkey): six posts of one video in Portuguese,
 * Turkish and Spanish, 3.4M views, were never one narrative — a video post has no picture vector,
 * so "the same picture" never held, and the captions' languages pulled the words apart. The upload's
 * id is exact and free: the narratives join posts that share it (Policy.narrative.sameVideo).
 *
 * The GIF shape was missed until the boxing cat (the owner, 2026-11-11): the first version read
 * only a number followed by a folder, which no GIF address has, so not one GIF post got a key
 * (0 of 86 on For You over three days). Thirty-five posts of one cat GIF, captioned "I didn't know
 * you could copy GIFs" in eight languages, were grouped by their words into a copy-GIF narrative
 * instead of with the cat's coin. A GIF's key is kept apart from a video's (`x-gif:`), so the two
 * id spaces can never collide.
 *
 * Here, in the X adapter, because the address's shape is this platform's; the runner reads it
 * through the registry. What breaks if changed carelessly: matching any number or name in the path.
 * The profile and media folders carry ids too, and two posts with the same account picture or the
 * same photo are not one video.
 */

const VIDEO_THUMB = /\/(?:amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\/(\d{6,25})\//;
const GIF_THUMB = /\/tweet_video_thumb\/([A-Za-z0-9_-]{8,40})\.(?:jpe?g|png|webp)(?:[?#]|$)/;

/** The upload id of a post's first video or GIF, from its stored media; null when it has none we can read. */
export function videoKeyOf(media: unknown): string | null {
  if (!Array.isArray(media)) return null;
  for (const m of media) {
    if (m === null || typeof m !== 'object') continue;
    const uri = (m as Record<string, unknown>)['uri'];
    if (typeof uri !== 'string') continue;
    const video = VIDEO_THUMB.exec(uri);
    if (video !== null) return `x-video:${video[1]}`;
    const gif = GIF_THUMB.exec(uri);
    if (gif !== null) return `x-gif:${gif[1]}`;
  }
  return null;
}
