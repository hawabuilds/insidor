/**
 * THE POST HEAD LINE, ONE COMPONENT FOR EVERY POST IN THE APP (the owner, 2026-11-11: "anywhere with
 * username, X and time should be aligned like For You"): the poster's picture, the @handle, the
 * platform's mark (a link to the post on its source), "·" and the age, and on the right whatever the
 * caller puts there (a card's views). For You's cards, the narrative screen's cards and the
 * Narratives tab's swipeable row all draw this, so the alignment cannot drift between them.
 *
 * ★ THE ALIGNMENT IS MEASURED, NOT EYEBALLED (head-line.module.css): one size of Inter for every
 * word, everything centred on one line, the drawn X exactly the capitals' height, and the X, the dot
 * and the age lowered a touch together so they sit optically centred beside a mostly lowercase
 * handle. Every length is in ems of the line's own size, so the small size (the row's captions) is
 * the same alignment scaled, not a second set of numbers.
 *
 * ★ THE APP'S ONE MIDDLE DOT LIVES HERE (screen-rules.test.ts): the owner's exception to "no middle
 * dots", for this line only.
 *
 * What breaks if changed carelessly: `MARK_BOX` is the X's padded box (icons.tsx `Filled` pads 3 of
 * every 30 units), sized so the drawn X is the capitals' height; change the icon's padding and the X
 * stops matching the letters.
 */

import type { ReactNode } from 'react';

import type { Rendered } from '../format/rendered.ts';
import type { Platform } from '../platform.ts';
import { PlatformMark } from './PlatformMark.tsx';
import { usePosterPic } from './usePosterPic.ts';
import { Value } from './Value.tsx';
import styles from './head-line.module.css';

/** The mark's box at each size, in px: its drawn X (72% of the box) is then the capitals' height. */
const MARK_BOX = { card: 15.1, small: 13.1 } as const;

export function HeadLine({ face, label, platform, sourceLabel, sourceLink, age, right = null, size = 'card' }: {
  face: { readonly file: string | null; readonly url: string | null };
  label: string;
  platform: Platform | null;
  sourceLabel: string;
  /** The post on its source; null (a deleted post, or none known): the mark is no link. */
  sourceLink: string | null;
  age: Rendered;
  right?: ReactNode;
  /** `card`: For You's 15px line with a 36px picture; `small`: the row's 13px caption with a 20px one. */
  size?: 'card' | 'small';
}) {
  const mark = platform === null ? null : <PlatformMark platform={platform} size={MARK_BOX[size]} />;
  return (
    <div className={`${styles['line']} ${styles[size]}`}>
      <Face key={`${face.file ?? ''} ${face.url ?? ''}`} file={face.file} url={face.url} label={label} />
      <span className={styles['who']}>
        <b className={styles['handle']}>{label}</b>
        {mark !== null && sourceLink !== null ? (
          <a className={styles['source']} href={sourceLink} target="_blank" rel="noopener noreferrer" aria-label={`Open the post on ${sourceLabel}`} onClick={(e) => e.stopPropagation()}>
            {mark}
          </a>
        ) : mark !== null ? (
          <span className={styles['source']}>{mark}</span>
        ) : null}
        <span className={styles['sep']} aria-hidden="true">·</span>
        <Value r={age} className={styles['age']} />
      </span>
      {right}
    </div>
  );
}

/** The poster's own picture (every @handle has its face, the owner's rule); the first letter only when none loads. */
function Face({ file, url, label }: { file: string | null; url: string | null; label: string }) {
  const { src, tryKey, onError } = usePosterPic(file, url);
  if (src !== null) return <img key={tryKey} className={styles['face']} src={src} alt="" loading="lazy" onError={onError} />;
  return <span className={styles['letter']} aria-hidden="true">{(label.replace(/^@/, '').trim()[0] ?? '?').toUpperCase()}</span>;
}
