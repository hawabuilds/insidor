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
  platform = null,
  platformLabel = '',
  round = false,
  letter = null,
}: {
  url: string | null;
  size?: number;
  platform?: Platform | null;
  platformLabel?: string;
  round?: boolean;
  /** For a coin with no image: its first letter, which is a fact, rather than a stock icon. */
  letter?: string | null;
}) {
  return (
    <span className={styles['thumb']} style={{ width: size, height: size }}>
      {url !== null ? (
        <img className={`${styles['thumbImg']} ${round ? styles['round'] : ''}`} src={url} alt="" loading="lazy" />
      ) : (
        <span className={`${styles['thumbEmpty']} ${round ? styles['round'] : ''}`}>
          {letter !== null ? <span className={styles['thumbLetter']}>{letter}</span> : <ImageIcon size={Math.round(size * 0.42)} />}
        </span>
      )}
      {platform !== null ? <PlatformBadge platform={platform} label={platformLabel} /> : null}
    </span>
  );
}
