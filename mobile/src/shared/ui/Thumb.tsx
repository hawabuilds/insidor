/**
 * The square picture at the start of a row, or a placeholder tile when there is none.
 *
 * A missing picture is a tile with an image glyph — the honest render of a picture we do not
 * have — never a borrowed one. The platform badge sits on the bottom-right corner when the
 * caller knows the platform, and is simply absent when it does not.
 */

import type { Platform } from '../platform.ts';
import { ImageIcon } from './icons.tsx';
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
}) {
  return (
    <span className={styles['thumb']} style={{ width, height, minWidth: width, minHeight: height, flexBasis: width }}>
      {url !== null ? (
        <img className={`${styles['thumbImg']} ${round ? styles['round'] : ''}`} style={round ? undefined : { borderRadius: radius }} src={url} alt="" loading="lazy" />
      ) : (
        <span className={`${styles['thumbEmpty']} ${round ? styles['round'] : ''}`} style={round ? undefined : { borderRadius: radius }}>
          {letter !== null ? <span className={styles['thumbLetter']}>{letter}</span> : <ImageIcon size={Math.round(Math.min(width, height) * 0.42)} />}
        </span>
      )}
      {platform !== null ? <PlatformBadge platform={platform} label={platformLabel} /> : null}
    </span>
  );
}
