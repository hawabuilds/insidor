/**
 * FOR YOU'S SORT CHIPS AND THEIR WINDOW, and remembering them (the owner, 2026-10-17): New (the
 * default, the feed as it always was, newest posted first), Trending and Most viewed, the last two
 * over 1h, 6h or 24h. Trending starts on 1h and Most viewed on 24h; each keeps its own window.
 *
 * ★ THE ORDER IS THE SERVER'S. New is the frame and its scroll; Trending and Most viewed are read
 * from the read service in its order (services/read/src/post-sorts.ts, which says exactly how each is
 * ranked). This file only decides which list is showing and remembers it.
 *
 * ★ REMEMBERED ON THIS PHONE ONLY, as a convenience: localStorage, every read and write in a
 * try/catch, so a private window or blocked storage just starts on New. A stored value this file
 * does not recognise is ignored, never trusted.
 *
 * What breaks if changed carelessly: the storage key. Renaming it forgets every person's choice once.
 */

import type { PostSortBy, PostSortWindow } from '../../shared/api/index.ts';

export type PostSort = 'new' | PostSortBy;

export const SORTS: readonly { readonly key: PostSort; readonly label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'trending', label: 'Trending' },
  { key: 'most_viewed', label: 'Most viewed' },
];

export const WINDOWS: readonly PostSortWindow[] = ['1h', '6h', '24h'];

export interface SortChoice {
  readonly sort: PostSort;
  /** Each windowed sort's own window. */
  readonly windows: Readonly<Record<PostSortBy, PostSortWindow>>;
}

export const DEFAULT_CHOICE: SortChoice = { sort: 'new', windows: { trending: '1h', most_viewed: '24h' } };

const KEY = 'insidor.forYouSort';

const isSort = (v: unknown): v is PostSort => v === 'new' || v === 'trending' || v === 'most_viewed';
const isWindow = (v: unknown): v is PostSortWindow => v === '1h' || v === '6h' || v === '24h';

/** A stored choice, read back; anything unrecognised falls back to the default, part by part. */
export function parseChoice(raw: string | null): SortChoice {
  if (raw === null) return DEFAULT_CHOICE;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return DEFAULT_CHOICE;
  }
  if (typeof o !== 'object' || o === null) return DEFAULT_CHOICE;
  const r = o as Record<string, unknown>;
  const w = typeof r['windows'] === 'object' && r['windows'] !== null ? (r['windows'] as Record<string, unknown>) : {};
  return {
    sort: isSort(r['sort']) ? r['sort'] : DEFAULT_CHOICE.sort,
    windows: {
      trending: isWindow(w['trending']) ? w['trending'] : DEFAULT_CHOICE.windows.trending,
      most_viewed: isWindow(w['most_viewed']) ? w['most_viewed'] : DEFAULT_CHOICE.windows.most_viewed,
    },
  };
}

export function loadChoice(): SortChoice {
  try {
    return parseChoice(window.localStorage.getItem(KEY));
  } catch {
    return DEFAULT_CHOICE;
  }
}

export function saveChoice(c: SortChoice): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* Not remembered this time; the choice still holds while the app is open. */
  }
}

/** The window the chosen sort is over, or null for New, which has none. */
export const windowOf = (c: SortChoice): PostSortWindow | null => (c.sort === 'new' ? null : c.windows[c.sort]);
