/**
 * The square picture at the start of a row, or a placeholder tile when there is none.
 *
 * A missing picture is a tile with an image glyph — the honest render of a picture we do not
 * have — never a borrowed one. The platform badge sits on the bottom-right corner when the
 * caller knows the platform, and is simply absent when it does not. A picture that fails to
 * load is a missing picture: it falls back to the same tile, never a broken-image box.
 *
 * A video's preview picture (`video`) carries a small play icon in its centre, so a still of a
 * video is not mistaken for a photo. The icon is drawn only over a picture that loaded: on the
 * empty tile it would claim a video we cannot show any of.
 *
 * ★ PASS THE LINK AS IT CAME, NEVER A RESIZED ONE. The picture host's copy at the box's size is
 * tried first and the link itself second; a few of its PNGs have no copy at a named size (404,
 * measured 2026-10-21) while the link loads. A caller that resized the link first left nothing to
 * fall back to, and those cards showed the empty tile. How a failure moves along the two, and the
 * one later retry, is usePictureTries.ts.
 */

import type { Platform } from '../platform.ts';
import { ImageIcon, PlayIcon } from './icons.tsx';
import { cardPictureUrl, sizeForBox } from './picture-size.ts';
import { PlatformBadge } from './PlatformMark.tsx';
import { usePictureTries } from './usePictureTries.ts';
import styles from './ui.module.css';

export function Thumb({
  url,
  size = 48,
  width = size,
  height = size,
  radius = 13,
  platform = null,
  platformLabel = '',
  round = false,
  letter = null,
  video = false,
}: {
  url: string | null;
  size?: number;
  /** A box that is not square: both default to `size`. */
  width?: number;
  height?: number;
  /** Corner radius of a square picture, in px. Ignored when `round`. */
  radius?: number;
  platform?: Platform | null;
  platformLabel?: string;
  round?: boolean;
  /** For a coin with no image: its first letter, which is a fact, rather than a stock icon. */
  letter?: string | null;
  /** The picture is a still of a video: a play icon sits on it. */
  video?: boolean;
}) {
  /* The host's copy at the box's size first (picture-size.ts), the link as it came if that fails. */
  const sources = url === null ? [] : [...new Set([cardPictureUrl(url, sizeForBox(Math.max(width, height))), url])];
  const { src: shown, tryKey, fail } = usePictureTries(sources);
  return (
    <span className={styles['thumb']} style={{ width, height, minWidth: width, minHeight: height, flexBasis: width }}>
      {shown !== null ? (
        <img key={tryKey} className={`${styles['thumbImg']} ${round ? styles['round'] : ''}`} style={round ? undefined : { borderRadius: radius }} src={shown} alt="" width={width} height={height} loading="lazy" decoding="async" onError={() => fail(shown)} />
      ) : (
        <span className={`${styles['thumbEmpty']} ${round ? styles['round'] : ''}`} style={round ? undefined : { borderRadius: radius }}>
          {letter !== null ? <span className={styles['thumbLetter']}>{letter}</span> : <ImageIcon size={Math.round(Math.min(width, height) * 0.42)} />}
        </span>
      )}
      {shown !== null && video ? (
        <span className={styles['play']} aria-label="Video">
          <PlayIcon size={Math.round(Math.min(width, height) * 0.22)} />
        </span>
      ) : null}
      {platform !== null ? <PlatformBadge platform={platform} label={platformLabel} /> : null}
    </span>
  );
}
