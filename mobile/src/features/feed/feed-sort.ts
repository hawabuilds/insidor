/**
 * FOR YOU'S SORT CHIPS, Most viewed's span, what a sorted card says, and remembering the choice (the
 * owner's design of 2026-10-18): New (the default, the feed as it always was, newest posted first),
 * Trending (one list, right now, no window chips) and Most viewed (Today or This week, Today first).
 *
 * ★ THE ORDER IS THE SERVER'S. New is the frame and its scroll; Trending and Most viewed are read
 * from the read service in its order (services/read/src/post-sorts.ts, which says exactly how each is
 * ranked). This file only decides which list is showing, remembers it, and words the facts a card
 * carries (the owner's third design, 2026-10-18): on Trending its views a minute over the last 30
 * minutes and how many times that is its views a minute over the hour before, up, steady or down; on
 * Most viewed Today and This week the views it gained in the window under its total; All time, the
 * total alone.
 *
 * ★ REMEMBERED ON THIS PHONE ONLY, as a convenience: localStorage, every read and write in a
 * try/catch, so a private window or blocked storage just starts on New. A stored value this file
 * does not recognise is ignored, never trusted: the choice stored before the redesign (a window per
 * sort, '1h' '6h' '24h') keeps its sort and falls back to Today for Most viewed.
 *
 * What breaks if changed carelessly: the storage key. Renaming it forgets every person's choice once.
 */

import type { PostSortBy, PostSortWindow, PostSpeeds } from '../../shared/api/index.ts';
import { compact } from '../../shared/format/number.ts';

export type PostSort = 'new' | PostSortBy;
export type ViewedSpan = 'today' | 'week' | 'all';

export const SORTS: readonly { readonly key: PostSort; readonly label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'trending', label: 'Trending' },
  { key: 'most_viewed', label: 'Most viewed' },
];

/** Most viewed's chips: the posts posted today, or this week. */
export const SPANS: readonly { readonly key: ViewedSpan; readonly label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'all', label: 'All time' },
];

export interface SortChoice {
  readonly sort: PostSort;
  /** Most viewed's span; Trending has none. */
  readonly span: ViewedSpan;
}

export const DEFAULT_CHOICE: SortChoice = { sort: 'new', span: 'today' };

const KEY = 'insidor.forYouSort';

const isSort = (v: unknown): v is PostSort => v === 'new' || v === 'trending' || v === 'most_viewed';
const isSpan = (v: unknown): v is ViewedSpan => v === 'today' || v === 'week' || v === 'all';

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
  return {
    sort: isSort(r['sort']) ? r['sort'] : DEFAULT_CHOICE.sort,
    span: isSpan(r['span']) ? r['span'] : DEFAULT_CHOICE.span,
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

/** The list the chosen sort asks the server for, or null for New, which is the feed itself. */
export const windowOf = (c: SortChoice): PostSortWindow | null => (c.sort === 'new' ? null : c.sort === 'trending' ? 'now' : c.span);

/** Views a minute as a card says it: one decimal under 10, then whole, then 12K. */
const perMin = (n: number): string => (n < 10 ? n.toFixed(1).replace(/\.0$/, '') : compact(n));

/** What Trending says when nothing fresh is gaining over the floor: a fact, not an apology. */
export const NO_RISERS = 'Nothing is speeding up right now.';

/**
 * Trending's line under a card's views: "394 views a minute, up 1.4x in the last hour", the ratio of
 * the two speeds the server sent, to one decimal. A post filled in from the 1h rule may be flat or
 * slowing, and says so: "steady over the last hour", "down to 0.9x in the last hour". A post that
 * gained nothing before says that instead of a ratio it does not have.
 */
export function speedLine(s: PostSpeeds): { readonly text: string; readonly up: boolean } {
  const now = perMin(s.now);
  const unit = now === '1' ? 'view a minute' : 'views a minute';
  if (s.before <= 0) return { text: `${now} ${unit}, up from none in the hour before`, up: s.now > 0 };
  const ratio = (s.now / s.before).toFixed(1);
  const change = ratio === '1.0' ? 'steady over the last hour' : s.now > s.before ? `up ${ratio}x in the last hour` : `down to ${ratio}x in the last hour`;
  return { text: `${now} ${unit}, ${change}`, up: s.now > s.before && ratio !== '1.0' };
}

/** Most viewed's line under the card's total: "+3.2M this week", "+48K today"; All time has none. */
export function gainedLine(gained: number, span: ViewedSpan): { readonly text: string; readonly up: boolean } | null {
  if (span === 'all') return null;
  return { text: `+${compact(gained)} ${span === 'week' ? 'this week' : 'today'}`, up: gained > 0 };
}
