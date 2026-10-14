/**
 * THE POST'S MEDIA INSIDE THE POST SHEET: its video, played here; its GIF, looping here; or its
 * picture, shown whole.
 *
 * The video is an HTML video element on the post's own file (services/read post-sheet.ts passes
 * one only when it is an https mp4 the source serves unsigned). It starts muted and still; the
 * round play button plays it and the pause control stops it; under it sit the sound toggle, a
 * progress bar you can tap to seek, the current and total time, and full screen (the viewer
 * below). A GIF arrives as a picture with a file
 * (`kind: 'image'` and a `playUrl`): it plays at once, muted, over and over, with no controls,
 * the way the source shows it.
 *
 * ★ A TAP ON THE MEDIA OPENS IT FULL SCREEN (`Viewer`), over the sheet: the picture whole, or the
 * video playing with its own controls from where it was. The box in the sheet is small (never more
 * than 200px tall, PostSheet.tsx), so this is where it is seen properly. On a video the round play
 * button plays it right there, and the controls under it work as before; a tap anywhere else on the
 * video, or the full-screen control, opens the viewer. The viewer closes with its X, a swipe down,
 * back or Escape, and the sheet is where it was.
 *
 * ★ PLAYED HERE, NEVER SENT OUT — EXCEPT WHEN IT CANNOT PLAY. A video with no file, or whose file
 * fails (an error, or a browser that refuses it), shows its full still and a small "Play on X"
 * link to the post: the one way out of the media, and only then (the owner, 2026-10-13). Never a
 * play button that does nothing. A picture shows no link: there is nothing more to see.
 *
 * ★ A TIKTOK VIDEO PLAYS IN TIKTOK'S OWN PLAYER (`tiktokId`, TikTokPlayer.tsx). Its file is a 403 to
 * any page but TikTok's (tiktok-player.ts), so it never has a `playUrl`; with the post's id it opens
 * as its cover and our play button, and the tap brings up their player, with their controls, in
 * the same box. If that player cannot play, it is the still with "Play on TikTok", as above.
 *
 * ★ NEVER A BLANK BOX. A picture or still that will not load takes the media box away (`onGone`),
 * so the sheet closes up rather than showing an empty frame.
 *
 * ★ NO REFERRER LEAVES THE APP. The text source's video host answers 403 to a browser whose request
 * names another site as where it came from (measured 2026-10-13: the same mp4 is 200 with no
 * Referer or with the source's own, 403 with insidor.app's) — that, not a missing file, is why
 * every X video in the sheet failed. A video element has no referrer setting of its own, so this
 * file sets the page's policy to `same-origin` when it loads, before any video can ask: our own
 * /api calls keep theirs, and nothing sent to another site names the app.
 *
 * What breaks if changed carelessly: the referrer policy above — without it every X video is a
 * 403 and every post shows "Play on X". `playsInline` and `muted` at the start. Without them an iPhone
 * opens its own full-screen player on the first tap and refuses to start sound it was not asked for.
 * And only a real media failure may count as broken: `play()` also rejects when a pause interrupts
 * it, and treating that as a failure would swap a working video for the still.
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';

import type { SheetMedia } from '../../shared/api/index.ts';
import { useDismiss, useSwipeClose } from '../../shared/ui/dismiss.ts';
import { CloseIcon } from '../../shared/ui/icons.tsx';
import { TikTokPlayer } from './TikTokPlayer.tsx';
import { FullIcon, OpenIcon, PauseIcon, PlayFillIcon, SoundOffIcon, SoundOnIcon } from './sheet-icons.tsx';
import styles from './post-sheet.module.css';
import own from './post-media.module.css';

/** The page's referrer policy, set once (see the header). A policy the page already sets is left. */
function keepReferrerHome(): void {
  if (typeof document === 'undefined' || document.querySelector('meta[name="referrer"]') !== null) return;
  const meta = document.createElement('meta');
  meta.name = 'referrer';
  meta.content = 'same-origin';
  document.head.appendChild(meta);
}
keepReferrerHome();

/** "0:04", "1:12": minutes and seconds, the way a player says them. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface PostMediaProps {
  readonly media: SheetMedia;
  readonly height: number;
  readonly onGone: () => void;
  /** The post on its source, for "Play on X" when the video cannot play here; null: no link. */
  readonly postUrl?: string | null;
  /** The source's name, as the sheet's open button says it ("X"). */
  readonly sourceLabel?: string | null;
  /** The video's TikTok id: with no file of its own, it plays in TikTok's player; null: not TikTok. */
  readonly tiktokId?: string | null;
}

/** What the full-screen viewer shows: the picture, or the video from a time, with or without sound. */
type Full = { readonly kind: 'picture' } | { readonly kind: 'video'; readonly at: number; readonly muted: boolean; readonly loop: boolean };

export function PostMedia({ media, height, onGone, postUrl = null, sourceLabel = null, tiktokId = null }: PostMediaProps) {
  const [broken, setBroken] = useState(false);
  const [full, setFull] = useState<Full | null>(null);
  /* Stable, so the TikTok player's message listener is not rebuilt on every render of the sheet. */
  const fail = useCallback(() => setBroken(true), []);
  let box;
  if (media.playUrl === null && media.kind === 'video' && tiktokId !== null && !broken) {
    box = <TikTokPlayer id={tiktokId} posterUrl={media.posterUrl} height={height} onFail={fail} />;
  } else if (media.playUrl === null || broken) {
    const out = media.kind === 'video' || media.playUrl !== null ? postUrl : null;
    box = (
      <div className={`${styles['media']} ${own['tappable']}`} style={{ height }} onClick={() => setFull({ kind: 'picture' })}>
        <img className={styles['mediaImg']} src={media.posterUrl} alt="" onError={onGone} />
        {out !== null ? (
          <a className={own['out']} href={out} target="_blank" rel="noopener noreferrer" data-no-swipe onClick={(e) => e.stopPropagation()}>
            Play on {sourceLabel ?? 'the source'} <OpenIcon size={14} />
          </a>
        ) : null}
      </div>
    );
  } else if (media.kind === 'image') {
    box = <Loop media={media} height={height} onBroken={fail} onFull={() => setFull({ kind: 'video', at: 0, muted: true, loop: true })} />;
  } else {
    box = <Player media={media} height={height} onBroken={fail} onFull={(at, muted) => setFull({ kind: 'video', at, muted, loop: false })} />;
  }
  return (
    <>
      {box}
      {full !== null ? <Viewer media={media} full={broken ? { kind: 'picture' } : full} onClose={() => setFull(null)} /> : null}
    </>
  );
}

/**
 * The media full screen, over everything (a portal on the page, so no sheet clips it): black, the
 * picture or video whole at its own shape, a 44px X at the top right. Closes with the X, a swipe
 * down, back or Escape, one layer like any pop-up (shared/ui/dismiss.ts), back to the sheet.
 */
function Viewer({ media, full, onClose }: { media: SheetMedia; full: Full; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  useDismiss(onClose);
  useSwipeClose(panel, onClose);
  useEffect(() => {
    const v = video.current;
    if (v === null || full.kind !== 'video') return;
    v.currentTime = full.at;
    void v.play().catch(() => undefined);
  }, [full]);
  return createPortal(
    <div ref={panel} className={own['viewer']} role="dialog" aria-modal="true" aria-label="Full screen" data-sheet-grab>
      {full.kind === 'video' && media.playUrl !== null ? (
        <video
          ref={video}
          className={own['viewerMedia']}
          src={media.playUrl}
          poster={media.posterUrl}
          muted={full.muted}
          loop={full.loop}
          controls={!full.loop}
          playsInline
          autoPlay
        />
      ) : (
        <img className={own['viewerMedia']} src={media.posterUrl} alt="" />
      )}
      <button type="button" className={own['viewerClose']} aria-label="Close" onClick={onClose}>
        <CloseIcon size={18} />
      </button>
    </div>,
    document.body,
  );
}

/** Whether a rejected `play()` means the file cannot play, rather than a pause or a policy. */
function unplayable(v: HTMLVideoElement, e: unknown): boolean {
  return v.error !== null || (e instanceof DOMException && e.name === 'NotSupportedError');
}

/** A GIF: muted, looping, playing as soon as it can, no controls. */
function Loop({ media, height, onBroken, onFull }: { media: SheetMedia; height: number; onBroken: () => void; onFull: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  /* A tap opens it full screen; a phone that held back autoplay (low power) starts it then too. */
  const start = () => {
    const v = video.current;
    if (v !== null && v.paused) void v.play().catch((e: unknown) => unplayable(v, e) && onBroken());
    onFull();
  };
  return (
    <div className={`${styles['media']} ${own['tappable']}`} style={{ height }}>
      <video
        ref={video}
        className={styles['mediaVideo']}
        src={media.playUrl ?? undefined}
        poster={media.posterUrl}
        muted
        loop
        autoPlay
        playsInline
        preload="auto"
        onClick={start}
        onError={onBroken}
      />
    </div>
  );
}

function Player({ media, height, onBroken, onFull }: { media: SheetMedia; height: number; onBroken: () => void; onFull: (at: number, muted: boolean) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [time, setTime] = useState(0);
  const [total, setTotal] = useState(media.durationMs === null ? 0 : media.durationMs / 1000);

  useEffect(() => {
    const v = video.current;
    if (v === null) return;
    const onTime = () => setTime(v.currentTime);
    const onMeta = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) setTotal(v.duration);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onPause);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onPause);
    };
  }, []);

  const toggle = () => {
    const v = video.current;
    if (v === null) return;
    if (v.paused) void v.play().catch((e: unknown) => unplayable(v, e) && onBroken());
    else v.pause();
  };
  const sound = () => {
    const v = video.current;
    if (v === null) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };
  const seek = (e: MouseEvent<HTMLButtonElement>) => {
    const v = video.current;
    if (v === null || total <= 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    v.currentTime = Math.min(total, Math.max(0, ((e.clientX - r.left) / r.width) * total));
    setTime(v.currentTime);
  };
  /* Full screen is the viewer: the video carries on there from where it was, and pauses here. */
  const full = () => {
    const v = video.current;
    if (v === null) return;
    const at = v.currentTime;
    v.pause();
    onFull(at, v.muted);
  };
  const shown = total > 0 ? Math.min(1, time / total) : 0;

  return (
    <div className={`${styles['media']} ${own['tappable']}`} style={{ height }}>
      <video
        ref={video}
        className={styles['mediaVideo']}
        src={media.playUrl ?? undefined}
        poster={media.posterUrl}
        muted
        playsInline
        preload="metadata"
        onClick={full}
        onError={onBroken}
      />
      {!playing ? (
        <button type="button" className={styles['bigPlay']} aria-label="Play video" onClick={toggle}>
          <PlayFillIcon size={26} />
        </button>
      ) : null}
      <div className={styles['controls']} data-no-swipe>
        <button type="button" className={styles['ctl']} aria-label={muted ? 'Turn sound on' : 'Turn sound off'} onClick={sound}>
          <span className={styles['ctlDot']}>{muted ? <SoundOffIcon size={16} /> : <SoundOnIcon size={16} />}</span>
        </button>
        <button type="button" className={styles['track']} aria-label="Seek" onClick={seek}>
          <span className={styles['trackBar']}>
            <span className={styles['trackFill']} style={{ width: `${shown * 100}%` }} />
          </span>
        </button>
        <span className={styles['clock']}>{clock(time)} / {clock(total)}</span>
        {playing ? (
          <button type="button" className={styles['ctl']} aria-label="Pause" onClick={toggle}>
            <span className={styles['ctlDot']}><PauseIcon size={14} /></span>
          </button>
        ) : null}
        <button type="button" className={styles['ctl']} aria-label="Full screen" onClick={full}>
          <span className={styles['ctlDot']}><FullIcon size={16} /></span>
        </button>
      </div>
    </div>
  );
}
