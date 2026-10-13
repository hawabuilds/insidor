/**
 * THE POST'S MEDIA INSIDE THE POST SHEET: its video, played here, or its picture, shown whole.
 *
 * The video is an HTML video element on the post's own file (services/read post-sheet.ts passes
 * one only when it is an https mp4 the source serves unsigned). It starts muted and still; a tap
 * plays or pauses it; under it sit the sound toggle, a progress bar you can tap to seek, the
 * current and total time, and full screen. ★ NOTHING HERE LINKS OUT: no tap on the media ever
 * opens the source's site or app. The sheet's open button is the one way out, and it is not here.
 *
 * ★ NEVER A BLANK BOX. A video that will not play shows its still; a picture or still that will not
 * load takes the media box away (`onGone`), so the sheet closes up rather than showing an empty
 * frame. A post whose source gives no playable file (every short-video post: its links are signed
 * and expire) shows the still with no play button, because there is nothing we can play.
 *
 * What breaks if changed carelessly: `playsInline` and `muted` at the start. Without them an iPhone
 * opens its own full-screen player on the first tap and refuses to start sound it was not asked for.
 */

import { useEffect, useRef, useState, type MouseEvent } from 'react';

import type { SheetMedia } from '../../shared/api/index.ts';
import { FullIcon, PauseIcon, PlayFillIcon, SoundOffIcon, SoundOnIcon } from './sheet-icons.tsx';
import styles from './post-sheet.module.css';

/** "0:04", "1:12": minutes and seconds, the way a player says them. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function PostMedia({ media, height, onGone }: { media: SheetMedia; height: number; onGone: () => void }) {
  const [still, setStill] = useState(media.kind === 'image' || media.playUrl === null);
  if (still) {
    return (
      <div className={styles['media']} style={{ height }}>
        <img className={styles['mediaImg']} src={media.posterUrl} alt="" onError={onGone} />
      </div>
    );
  }
  return <Player media={media} height={height} onBroken={() => setStill(true)} />;
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
    if (v.paused) void v.play().catch(onBroken);
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
  const full = () => {
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    const el = box.current;
    if (el !== null && typeof el.requestFullscreen === 'function' && document.fullscreenEnabled) void el.requestFullscreen().catch(() => v?.webkitEnterFullscreen?.());
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
      <div className={styles['controls']}>
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
