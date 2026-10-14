/**
 * A TIKTOK VIDEO PLAYED IN THE POST SHEET with TikTok's own player (the owner, 2026-10-14: "i want
 * the post card for pop up tiktok videos playable"). Why their player and not our video element is
 * in tiktok-player.ts: the file is a 403 to any page but TikTok's.
 *
 * It opens as the post's cover with our round play button, the same box and size as an X video, so
 * nothing of TikTok's loads until it is wanted. The tap creates the player frame, playing, muted;
 * from there the controls are TikTok's own (play, sound, progress, time, full screen), and they look
 * like TikTok's, not like ours.
 *
 * ★ NOTHING IN THE FRAME CAN TAKE THE APP AWAY. The frame is sandboxed to scripts, its own origin
 * and full screen (the player needs all three to play) and nothing else: no top navigation and no
 * popups, so the player's links to TikTok (the name, the logo, like, share) do nothing. The sheet's
 * open button stays the one way out.
 *
 * ★ A PLAYER THAT CANNOT PLAY IS A STILL, NEVER A BLANK BOX. A failed play reloads the player once
 * (the first play in a browser without TikTok's cookie fails, tiktok-player.ts); a second failure,
 * or a page that says nothing within `SILENT_WAIT_MS`, calls `onFail`, and PostMedia shows the
 * cover with "Play on TikTok".
 *
 * What breaks if changed carelessly: adding `allow-top-navigation` or `allow-popups` lets a tap in
 * the player leave the app; dropping `allow-same-origin` stops it playing. Creating the frame before
 * the tap loads TikTok's tracking on every sheet opened.
 */

import { useEffect, useRef, useState } from 'react';

import { PlayFillIcon } from './sheet-icons.tsx';
import { playerSays, playerUrl, RETRIES, SILENT_WAIT_MS } from './tiktok-player.ts';
import styles from './post-sheet.module.css';
import own from './post-media.module.css';

export function TikTokPlayer({ id, posterUrl, height, onFail }: { id: string; posterUrl: string; height: number; onFail: () => void }) {
  const [started, setStarted] = useState(false);
  if (!started) {
    return (
      <div className={styles['media']} style={{ height }}>
        <img className={styles['mediaImg']} src={posterUrl} alt="" />
        <button type="button" className={styles['bigPlay']} aria-label="Play video" onClick={() => setStarted(true)}>
          <PlayFillIcon size={26} />
        </button>
      </div>
    );
  }
  return <Frame id={id} height={height} onFail={onFail} />;
}

function Frame({ id, height, onFail }: { id: string; height: number; onFail: () => void }) {
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
      <iframe
        key={attempt}
        ref={frame}
        className={own['frame']}
        src={playerUrl(id, true)}
        title="TikTok video"
        sandbox="allow-scripts allow-same-origin allow-presentation"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}
