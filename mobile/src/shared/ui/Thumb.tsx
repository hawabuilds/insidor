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
 *
 * ★ OUR STORED COPY BEFORE EITHER (`file`, the reply's `thumbFile`): the source's signed link
 * expires — a short-video cover about a day after the read — and the server keeps a copy of every
 * shown post's picture (shared/post-pic.ts says where). A box with no copy tries the two links as
 * before, so nothing looks different; a box whose link has expired still shows its picture.
 */

import type { Platform } from '../platform.ts';
import { postPicSources, type PictureRef } from '../post-pic.ts';
import { ImageIcon, PlayIcon } from './icons.tsx';
import { cardPictureUrl, sizeForBox } from './picture-size.ts';
import { POST_PIC_BASE } from './post-pic-base.ts';
import { PlatformBadge } from './PlatformMark.tsx';
import { usePictureTries } from './usePictureTries.ts';
import styles from './ui.module.css';

export function Thumb({
  url,
  file = null,
  size = 48,
  width = size,
  height = size,
  radius = 13,
  platform = null,
  platformLabel = '',
  round = false,
  letter = null,
  video = false,
  more = [],
}: {
  url: string | null;
  /** Our storage's copy of the picture, by file name (the reply's `thumbFile`); null when there is none yet. */
  file?: string | null;
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
  /** Further pictures of the same thing, tried in order after this one fails (a narrative's posts': storyPictures in post-pic.ts). */
  more?: readonly PictureRef[];
}) {
  /* Our copy first (post-pic.ts), then the host's copy at the box's size (picture-size.ts), then the link as it came; then each of `more` the same way. */
  const box = sizeForBox(Math.max(width, height));
  const each = (u: string | null, f: string | null) => postPicSources(f, u === null ? [] : [cardPictureUrl(u, box), u], POST_PIC_BASE, 'card');
  const sources = [...new Set([...each(url, file), ...more.flatMap((p) => each(p.url, p.file))])];
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
