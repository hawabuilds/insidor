/**
 * The TikTok player's decisions, apart from its frame (TikTokPlayer.tsx) so `node --test` can hold
 * them: the post's video id from our post id, the official player's address with its settings, and
 * what one of the player's messages means.
 *
 * Why the official player at all (measured 2026-10-14): the video file TikTok hands out is signed
 * for the session that asked for it and is a 403 to anyone else — with no Referer, with ours, with
 * TikTok's, from an iPhone or a desktop. It plays only with that session's cookie AND TikTok's own
 * Referer, which a page on our site can never send. So the file can never be played by our own
 * video element, and serving it through our server would be re-hosting their video. Their player
 * page (`/player/v1/<id>`) carries no frame block, so it can sit in the sheet.
 *
 * ★ THE FIRST PLAY CAN FAIL AND THE SECOND WORKS. A browser that has never opened TikTok has no
 * session cookie when the player page loads, and the player's first play is a PLAYBACK_ERROR; the
 * page load itself sets the cookie, so the same page loaded again plays. `RETRIES` is that one
 * reload; a second failure is a real one (a deleted or private video) and the still comes back.
 *
 * ★ IT NEVER STARTS ITSELF, SO IT HAS SOUND (the owner, 2026-10-14: "tiktok video not playing
 * sound"). With `autoplay=1` the player always starts muted, whatever `muted` says (measured in
 * Safari and Chrome), and a phone only lets sound start from a tap inside the frame: unmuting it
 * from our page (its `unMute` message) makes Safari pause it instead. So the player loads still, and
 * the viewer's tap on its own play button starts it, with sound.
 *
 * What breaks if changed carelessly: reading messages from any origin lets another frame stop or
 * fake the player. `autoplay=1`, or `muted=1`, brings back a video with no sound on the iPhone.
 */

export const PLAYER_ORIGIN = 'https://www.tiktok.com';
/** How many times a failed play reloads the player before the still comes back (see the header). */
export const RETRIES = 1;
/**
 * How long the player page has to say anything at all before it counts as blocked or down. Not
 * how long it has to be ready: a player that is not playing says `ready` only once it is tapped,
 * and TikTok's cookie notice (shown in some countries) waits for an answer; those waits are the
 * viewer's, not a failure. The page's own hello comes within a second.
 */
export const SILENT_WAIT_MS = 12_000;

/** The video's id on TikTok, from our post id (`tiktok:<digits>`); null for anything else. */
export function tiktokVideoId(postId: string): string | null {
  const m = /^tiktok:(\d{6,25})$/.exec(postId);
  return m?.[1] ?? null;
}

/**
 * The official player for one video: its own controls, not playing until its play button is tapped
 * (so it plays with sound, see the header), no description, music line or related videos.
 */
export function playerUrl(id: string): string {
  const q = new URLSearchParams({
    controls: '1',
    autoplay: '0',
    loop: '0',
    description: '0',
    music_info: '0',
    rel: '0',
    native_context_menu: '0',
    closed_caption: '0',
  });
  return `${PLAYER_ORIGIN}/player/v1/${id}?${q}`;
}

/** What one message says: the page is alive, the player is ready, it is playing, it failed, or nothing. */
export type PlayerSays = 'alive' | 'ready' | 'playing' | 'failed';

export function playerSays(origin: string, data: unknown): PlayerSays | null {
  if (origin !== PLAYER_ORIGIN) return null;
  let d: unknown = data;
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d);
    } catch {
      /* The page's own analytics script says "[tea-sdk]ready" as plain text: the page is up. */
      return 'alive';
    }
  }
  if (typeof d !== 'object' || d === null) return 'alive';
  const m = d as Record<string, unknown>;
  if (m['x-tiktok-player'] !== true) return 'alive';
  switch (m['type']) {
    case 'onPlayerReady':
      return 'ready';
    case 'onPlayerError':
    case 'onError':
      return 'failed';
    case 'onStateChange':
      return m['value'] === 1 ? 'playing' : 'alive';
    case 'onCurrentTime':
      return 'playing';
    default:
      return 'alive';
  }
}
