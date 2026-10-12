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
 */

import { useState } from 'react';

import type { Platform } from '../platform.ts';
import { ImageIcon, PlayIcon } from './icons.tsx';
import { PlatformBadge } from './PlatformMark.tsx';
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
  const [failed, setFailed] = useState<string | null>(null);
  const shown = url !== null && failed !== url ? url : null;
  return (
    <span className={styles['thumb']} style={{ width, height, minWidth: width, minHeight: height, flexBasis: width }}>
      {shown !== null ? (
        <img className={`${styles['thumbImg']} ${round ? styles['round'] : ''}`} style={round ? undefined : { borderRadius: radius }} src={shown} alt="" loading="lazy" onError={() => setFailed(shown)} />
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
