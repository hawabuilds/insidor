/**
 * The picture on a row.
 *
 * A missing image gets a real placeholder rather than a broken-image icon or a zero-height
 * box: rows are a fixed height and a collapsing cell shifts every row below it, which on a
 * board that repaints every tick looks like the whole table twitching.
 */

import styles from './primitives.module.css';

export function Thumb({ url, alt }: { url: string | null; alt: string }) {
  if (!url) {
    return (
      <span className={styles['thumbEmpty']} role="img" aria-label={`${alt} — no image`}>
        —
      </span>
    );
  }
  return (
    <img
      className={styles['thumb']}
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      /* The board shows other people's media. Referrers are not their business. */
      referrerPolicy="no-referrer"
    />
  );
}
