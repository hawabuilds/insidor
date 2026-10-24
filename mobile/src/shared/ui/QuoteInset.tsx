/**
 * THE QUOTED POST INSIDE A POST'S CARD, as the source draws it (the owner, 2026-10-24: "I want to
 * see the original image of quote-tweeted posts along with the quote-tweeted message"): a bordered
 * box under the post's own words with the quoted account's picture, name and @handle, its words cut
 * to a few lines, and its picture.
 *
 * ★ ONE PICTURE, NEVER TWO. A quote with no picture of its own leads its card with the quoted
 * post's picture (the server puts it in `thumbUrl`, `quotePictureLeads`); the box then shows no
 * second copy of it. A quote with a picture of its own keeps it, and the box shows the quoted
 * picture small at its side.
 *
 * Shared by the feed card (PostRow.tsx) and the post sheet (PostSheet.tsx), so the two draw the
 * quoted post the same way. On the card the box is part of the card's tap (it opens the sheet); on
 * the sheet, where `link` is set, it opens the quoted post on its source.
 *
 * What breaks if changed carelessly: the face. Every @handle shown has its picture beside it (the
 * owner's rule); the letter stands in only when no picture loads (usePosterPic.ts).
 */

import type { QuotedPost } from '../api/wire/rising.ts';
import { formatAge } from '../format/duration.ts';
import { Thumb } from './Thumb.tsx';
import { usePosterPic } from './usePosterPic.ts';
import { Value } from './Value.tsx';
import styles from './quote-inset.module.css';

export function QuoteInset({ quote, showPicture, now, lines = 2, link = false }: { quote: QuotedPost; showPicture: boolean; now: number; lines?: number; link?: boolean }) {
  const handle = quote.authorLabel.startsWith('@') ? quote.authorLabel : null;
  const name = quote.authorName ?? quote.authorLabel;
  const age = formatAge(quote.postedAt, now);
  const picture = showPicture && quote.thumbUrl !== null;
  const body = (
    <>
      <span className={styles['text']}>
        <span className={styles['who']}>
          <Face key={`${quote.authorPictureFile ?? ''} ${quote.authorPictureUrl ?? ''}`} file={quote.authorPictureFile} url={quote.authorPictureUrl} label={name} />
          <b className={styles['name']}>{name}</b>
          {handle !== null && quote.authorName !== null ? <span className={styles['handle']}>{handle}</span> : null}
          {age.kind === 'value' ? <Value r={age} className={styles['age']} /> : null}
        </span>
        {quote.excerpt !== '' ? <span className={styles['words']} style={{ WebkitLineClamp: lines }}>{quote.excerpt}</span> : null}
      </span>
      {picture ? (
        <span className={styles['picture']}>
          <Thumb url={quote.thumbUrl} file={quote.thumbFile} video={quote.thumbIsVideo} width={56} height={56} radius={10} />
        </span>
      ) : null}
    </>
  );
  if (link && quote.permalink !== null) {
    return (
      <a className={styles['quote']} href={quote.permalink} target="_blank" rel="noopener noreferrer" aria-label={`Quoted post by ${name}`} onClick={(e) => e.stopPropagation()}>
        {body}
      </a>
    );
  }
  return (
    <div className={styles['quote']} aria-label={`Quoted post by ${name}`}>
      {body}
    </div>
  );
}

/** The quoted account's picture (our copy, else the source's link), or its first letter when none loads. */
function Face({ file, url, label }: { file: string | null; url: string | null; label: string }) {
  const { src, tryKey, onError } = usePosterPic(file, url);
  if (src !== null) return <img key={tryKey} className={styles['face']} src={src} alt="" loading="lazy" onError={onError} />;
  return <span className={styles['letter']} aria-hidden="true">{(label.replace(/^@/, '').trim()[0] ?? '?').toUpperCase()}</span>;
}
