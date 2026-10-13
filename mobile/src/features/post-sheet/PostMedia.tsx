/**
 * THE POST'S MEDIA INSIDE THE POST SHEET: its video, played here; its GIF, looping here; or its
 * picture, shown whole.
 *
 * The video is an HTML video element on the post's own file (services/read post-sheet.ts passes
 * one only when it is an https mp4 the source serves unsigned). It starts muted and still; a tap
 * plays or pauses it; under it sit the sound toggle, a progress bar you can tap to seek, the
 * current and total time, and full screen (the box's own full screen where the browser has one,
 * the iPhone's video player where it does not). A GIF arrives as a picture with a file
 * (`kind: 'image'` and a `playUrl`): it plays at once, muted, over and over, with no controls,
 * the way the source shows it.
 *
 * ★ PLAYED HERE, NEVER SENT OUT — EXCEPT WHEN IT CANNOT PLAY. A video with no file, or whose file
 * fails (an error, or a browser that refuses it), shows its full still and a small "Play on X"
 * link to the post: the one way out of the media, and only then (the owner, 2026-10-13). Never a
 * play button that does nothing. A picture shows no link: there is nothing more to see.
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

import { useEffect, useRef, useState, type MouseEvent } from 'react';

import type { SheetMedia } from '../../shared/api/index.ts';
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
}

export function PostMedia({ media, height, onGone, postUrl = null, sourceLabel = null }: PostMediaProps) {
  const [broken, setBroken] = useState(false);
  const fail = () => setBroken(true);
  if (media.playUrl === null || broken) {
    const out = media.kind === 'video' || media.playUrl !== null ? postUrl : null;
    return (
      <div className={styles['media']} style={{ height }}>
        <img className={styles['mediaImg']} src={media.posterUrl} alt="" onError={onGone} />
        {out !== null ? (
          <a className={own['out']} href={out} target="_blank" rel="noopener noreferrer" data-no-swipe>
            Play on {sourceLabel ?? 'the source'} <OpenIcon size={14} />
          </a>
        ) : null}
      </div>
    );
  }
  if (media.kind === 'image') return <Loop media={media} height={height} onBroken={fail} />;
  return <Player media={media} height={height} onBroken={fail} />;
}

/** Whether a rejected `play()` means the file cannot play, rather than a pause or a policy. */
function unplayable(v: HTMLVideoElement, e: unknown): boolean {
  return v.error !== null || (e instanceof DOMException && e.name === 'NotSupportedError');
}

/** A GIF: muted, looping, playing as soon as it can, no controls. */
function Loop({ media, height, onBroken }: { media: SheetMedia; height: number; onBroken: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  /* A phone that holds back autoplay (low power) starts it on a tap instead. */
  const start = () => {
    const v = video.current;
    if (v !== null && v.paused) void v.play().catch((e: unknown) => unplayable(v, e) && onBroken());
  };
  return (
    <div className={styles['media']} style={{ height }}>
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

function Player({ media, height, onBroken }: { media: SheetMedia; height: number; onBroken: () => void }) {
  const box = useRef<HTMLDivElement>(null);
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
  /* The box's own full screen keeps these controls; an iPhone has none, and gets its video player. */
  const full = () => {
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    const el = box.current;
    if (document.fullscreenElement != null) void document.exitFullscreen().catch(() => undefined);
    else if (el !== null && typeof el.requestFullscreen === 'function' && document.fullscreenEnabled) void el.requestFullscreen().catch(() => v?.webkitEnterFullscreen?.());
    else v?.webkitEnterFullscreen?.();
  };
  const shown = total > 0 ? Math.min(1, time / total) : 0;

  return (
    <div ref={box} className={styles['media']} style={{ height }}>
      <video
        ref={video}
        className={styles['mediaVideo']}
        src={media.playUrl ?? undefined}
        poster={media.posterUrl}
        muted
        playsInline
        preload="metadata"
        onClick={toggle}
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
