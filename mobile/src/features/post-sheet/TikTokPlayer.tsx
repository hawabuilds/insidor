/**
 * A TIKTOK VIDEO PLAYED IN THE POST SHEET with TikTok's own player (the owner, 2026-10-14: "i want
 * the post card for pop up tiktok videos playable"). Why their player and not our video element is
 * in tiktok-player.ts: the file is a 403 to any page but TikTok's.
 *
 * It sits in the same box and size as an X video, over the post's cover (shown while the player
 * loads), still until the viewer taps TikTok's own play button. That tap, inside the frame, is
 * what lets it start WITH SOUND (the owner, 2026-10-14: "tiktok video not playing sound"). It used
 * to open on our play button and start the player by itself, and a player that starts itself is
 * always muted; a phone will not unmute it for a tap outside the frame (tiktok-player.ts). The
 * controls are TikTok's own (play, sound, progress, time, full screen) and look like TikTok's.
 *
 * ★ NOTHING IN THE FRAME CAN TAKE THE APP AWAY. The frame is sandboxed to scripts, its own origin
 * and full screen (the player needs all three to play) and nothing else: no top navigation and no
 * popups, so the player's links to TikTok (the name, the logo, like, share) do nothing. The sheet's
 * open button stays the one way out.
 *
 * ★ A PLAYER THAT CANNOT PLAY IS A STILL, NEVER A BLANK BOX. A failed play reloads the player once
 * (the first play in a browser without TikTok's cookie fails, tiktok-player.ts), still, for one more
 * tap — starting it by itself would start it muted; a second failure,
 * or a page that says nothing within `SILENT_WAIT_MS`, calls `onFail`, and PostMedia shows the
 * cover with "Play on TikTok".
 *
 * What breaks if changed carelessly: adding `allow-top-navigation` or `allow-popups` lets a tap in
 * the player leave the app; dropping `allow-same-origin` stops it playing. Putting our own play
 * button in front again (any tap outside the frame) brings back the silent video.
 */

import { useEffect, useRef, useState } from 'react';

import { playerSays, playerUrl, RETRIES, SILENT_WAIT_MS } from './tiktok-player.ts';
import styles from './post-sheet.module.css';
import own from './post-media.module.css';

export function TikTokPlayer({ id, posterUrl, height, onFail }: { id: string; posterUrl: string; height: number; onFail: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  /* Each reload is a new frame (its `key`), so the player starts clean with the cookie it now has. */
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let heard = false;
    let played = false;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const said = playerSays(e.origin, e.data);
      if (said === null) return;
      heard = true;
      if (said === 'playing') played = true;
      /* A failure after it has played (a stall near the end) is not worth a reload that starts it over. */
      if (said === 'failed' && !played) {
        if (attempt < RETRIES) setAttempt(attempt + 1);
        else onFail();
      }
    };
    window.addEventListener('message', onMessage);
    const t = setTimeout(() => {
      if (!heard) onFail();
    }, SILENT_WAIT_MS);
    return () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(t);
    };
  }, [id, attempt, onFail]);
  return (
    <div className={styles['media']} style={{ height }} data-no-swipe>
      {/* The cover, under the frame: what shows until the player has drawn itself. */}
      <img className={`${styles['mediaImg']} ${own['under']}`} src={posterUrl} alt="" />
      <iframe
        key={attempt}
        ref={frame}
        className={own['frame']}
        src={playerUrl(id)}
        title="TikTok video"
        sandbox="allow-scripts allow-same-origin allow-presentation"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}
