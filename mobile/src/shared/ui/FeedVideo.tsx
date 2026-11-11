/**
 * A POST'S VIDEO PLAYED INSIDE ITS FEED CARD: muted, looping, while the card is on screen, the way
 * X and TikTok play a feed. The card's still sits under it until the first frame draws. Its small
 * sound button turns the sound on here; a tap on the video opens it full screen (the post sheet's
 * Viewer, with sound and controls) from the second it was at.
 *
 * ★ ONE VIDEO PLAYS AT A TIME. A video starts when it reaches the middle of the screen
 * (`PLAY_BAND`) and pauses when it leaves; the one that starts last stops the one before (`playing` below). Two half-shown
 * cards never play over each other, and the phone decodes one video, not a screen's worth.
 *
 * ★ NOTHING LOADS OR PLAYS OFF SCREEN. The file is asked for only once the card first comes into
 * view (`preload="none"` until then), so a long feed costs the viewer's data only for what they
 * stop on. The file comes from the post's source, never from our servers. A page kept hidden for
 * Back (App.tsx, `useScreenActive`) pauses its video.
 *
 * ★ A VIDEO THAT CANNOT PLAY IS THE STILL, NEVER A BLANK BOX (`onFail`). Only a real media error
 * counts: `play()` also rejects when a pause or a scroll interrupts it, and treating that as a
 * failure would swap a working video for its still.
 *
 * What breaks if changed carelessly: `muted` and `playsInline` must be set from the start, or an
 * iPhone refuses to start the video by itself and opens its own full-screen player. And X answers
 * 403 to a video request that names another site as its referrer: the page's referrer policy is set
 * once at load by features/post-sheet/PostMedia.tsx (`keepReferrerHome`), which the app always loads.
 */

import { useEffect, useRef, useState, type MouseEvent } from 'react';

import { useScreenActive } from '../screen-active.ts';
import { SoundOffIcon, SoundOnIcon } from '../../features/post-sheet/sheet-icons.tsx';
import styles from './feed-video.module.css';

/** The middle band of the screen a video plays in: the top and bottom 20% trimmed off. */
const PLAY_BAND = '-20% 0px -20% 0px';

/** The one video playing in the feed right now; a video that starts pauses it. */
let playing: HTMLVideoElement | null = null;

/**
 * `silent`: a GIF, which has no sound and so no sound button. `onOpen`: a tap on the video, with
 * the second it was at, so full screen carries on from there. `hold`: full screen is open over it,
 * so it pauses, and plays again (if still in view) once that closes.
 */
export function FeedVideo({ src, poster, silent, hold, onOpen, onFail }: { src: string; poster: string | null; silent: boolean; hold: boolean; onOpen: (at: number) => void; onFail: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [seen, setSeen] = useState(false);
  const [inView, setInView] = useState(false);
  const [muted, setMuted] = useState(true);
  const active = useScreenActive();

  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof IntersectionObserver === 'undefined') return;
    /* Two watchers: one on the whole screen (load the file once the card shows at all), one on the
       screen's middle band (play while the video sits in it). */
    const near = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting === true) setSeen(true);
    });
    const middle = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting === true), { rootMargin: PLAY_BAND });
    near.observe(el);
    middle.observe(el);
    return () => {
      near.disconnect();
      middle.disconnect();
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (el === null || !seen) return;
    if (inView && active && !hold) {
      if (playing !== null && playing !== el) playing.pause();
      playing = el;
      el.play().catch(() => undefined);
    } else {
      el.pause();
      if (playing === el) playing = null;
    }
  }, [inView, active, seen, hold]);

  useEffect(() => () => {
    if (playing === ref.current) playing = null;
  }, []);

  const toggleSound = (e: MouseEvent) => {
    e.stopPropagation();
    const el = ref.current;
    if (el === null) return;
    el.muted = !muted;
    setMuted(!muted);
    if (el.paused) el.play().catch(() => undefined);
  };

  return (
    <>
      <video
        ref={ref}
        className={styles['video']}
        src={seen ? src : undefined}
        poster={poster ?? undefined}
        muted
        loop
        playsInline
        preload={seen ? 'metadata' : 'none'}
        onError={onFail}
        onClick={(e) => {
          e.stopPropagation();
          onOpen(ref.current?.currentTime ?? 0);
        }}
      />
      {silent ? null : (
        <button type="button" className={styles['sound']} aria-label={muted ? 'Turn sound on' : 'Turn sound off'} onClick={toggleSound}>
          {muted ? <SoundOffIcon size={16} /> : <SoundOnIcon size={16} />}
        </button>
      )}
    </>
  );
}
