/**
 * A POST'S WORDS IN ENGLISH WHEN IT WAS WRITTEN IN ANOTHER LANGUAGE, the way the text source shows
 * it (the owner, 2026-10-14): the English in place of the original, and under it one small grey
 * line, "Translated from Portuguese", with "Show original" beside it (on a card, where the row is
 * narrow, the line itself is the tap). A tap shows the original words and "Show translation";
 * another tap goes back.
 *
 * Its own file because the card (PostRow) and the post sheet must say it the same way, and both
 * keep the choice per post while they are on screen. A post with no translation — in English, not
 * translated yet, or from a server without translations — shows its own words and no line, exactly
 * as before.
 *
 * ★ THE LINE IS A FACT ABOUT THE WORDS, NOT ABOUT US: which language they were written in and
 * that what is shown is a translation. Never how sure, never by what. A language the phone cannot
 * name is "Translated", never a bare code.
 *
 * What breaks if changed carelessly: the tap must stop at the line. On a card the whole card opens
 * the sheet, and a tap meant for "Show original" that also opened the sheet would make the
 * original unreachable on the feed.
 */

import { useState, type MouseEvent } from 'react';

import { languageName } from '../format/language.ts';
import type { PostTranslation } from '../api/wire/rising.ts';
import styles from './ui.module.css';

export interface ShownWords {
  /** The words to draw: the English, or the original when there is no translation or it was asked for. */
  readonly text: string;
  /** The line under them; null when the post has no translation. */
  readonly line: { readonly original: boolean; readonly language: string | null; readonly toggle: () => void } | null;
}

export function useShownWords(post: { readonly excerpt: string; readonly translation?: PostTranslation }): ShownWords {
  const [original, setOriginal] = useState(false);
  const t = post.translation;
  if (t === undefined) return { text: post.excerpt, line: null };
  return {
    text: original ? post.excerpt : t.text,
    line: { original, language: languageName(t.from), toggle: () => setOriginal((o) => !o) },
  };
}

/**
 * `compact` (the card, where the words share the row with the views): the line alone, the whole of
 * it the tap — "Translated from Portuguese", then "Show translation" — on one line. Otherwise (the
 * sheet): "Translated from Portuguese" and "Show original" beside it.
 */
export function TranslatedLine({ line, compact = false, className }: { line: ShownWords['line']; compact?: boolean; className?: string | undefined }) {
  if (line === null) return null;
  const tap = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    line.toggle();
  };
  const said = line.language === null ? 'Translated' : `Translated from ${line.language}`;
  if (compact) {
    return (
      <button type="button" className={`${styles['translated']} ${styles['translatedCompact']} ${className ?? ''}`} onClick={tap} aria-label={line.original ? 'Show translation' : `${said}. Show original`}>
        {line.original ? 'Show translation' : said}
      </button>
    );
  }
  return (
    <span className={`${styles['translated']} ${className ?? ''}`}>
      {line.original ? null : <span>{said}</span>}
      <button type="button" className={styles['translatedToggle']} onClick={tap}>
        {line.original ? 'Show translation' : 'Show original'}
      </button>
    </span>
  );
}
