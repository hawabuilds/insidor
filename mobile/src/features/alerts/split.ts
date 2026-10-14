/**
 * WHICH OF THE LIST GOES WHERE, Trador's split: the Feed tab shows what is happening (rising
 * posts, new narratives, a narrative getting its coin, a coin matched to a narrative you watch),
 * and the bell opens Notifications, what happened to YOU (your coins' multiples and curves,
 * follows, replies, rank-ups, and the owner's supplier and learning reports). It is the line
 * Trador draws between its Feed of other people's trades and its list of things about you.
 *
 * Its own pure file because the split decides what the bell counts and what each Feed tab
 * shows, and both are tested here without rendering.
 *
 * What breaks if changed carelessly: a kind on neither side is never shown. `onFeed` names the
 * Feed's kinds and everything else is a notification, so a kind added to the alert service later
 * lands in Notifications (seen and counted) rather than nowhere.
 */

import { tickerText } from '../../shared/format/ticker.ts';

const FEED_KINDS: readonly string[] = ['rising_post', 'narrative_promoted', 'narrative_coin', 'coin_matched'];

export const onFeed = (kind: string): boolean => FEED_KINDS.includes(kind);

export type FeedTab = 'watching' | 'rising' | 'latest';
export type FeedWindow = 'week' | 'all';

const DAY = 86_400_000;

/** The narrative an alert's link opens (`/#/story/<id>`), or null. */
export function storyOf(href: string): string | null {
  const m = /#\/story\/([^/?#]+)/.exec(href);
  if (m === null || m[1] === undefined) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** Seven calendar days, as Trador's "This week": since six days before this morning. */
export function weekStart(now: number): number {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return midnight.getTime() - 6 * DAY;
}

/**
 * One Feed tab. Watching: a coin matched to a narrative you starred, and any news about one you
 * starred. Rising: the rising posts, this week or all of them. Latest: the whole Feed. Newest
 * first throughout, as the list arrives.
 */
export function feedTab<T extends { readonly kind: string; readonly href: string; readonly at: number }>(items: readonly T[], tab: FeedTab, opts: { readonly starred: readonly string[]; readonly window: FeedWindow; readonly now: number }): readonly T[] {
  const feed = items.filter((a) => onFeed(a.kind));
  if (tab === 'latest') return feed;
  if (tab === 'rising') {
    const from = opts.window === 'week' ? weekStart(opts.now) : -Infinity;
    return feed.filter((a) => a.kind === 'rising_post' && a.at >= from);
  }
  return feed.filter((a) => {
    if (a.kind === 'coin_matched') return true;
    const story = storyOf(a.href);
    return story !== null && opts.starred.includes(story);
  });
}

/** Notifications: everything not on the Feed. */
export const notifications = <T extends { readonly kind: string }>(items: readonly T[]): readonly T[] => items.filter((a) => !onFeed(a.kind));

/** The bell's number: unread notifications only, as Trador's bell counts its own list. */
export const bellCount = (items: readonly { readonly kind: string; readonly unread: boolean }[]): number => items.filter((a) => a.unread && !onFeed(a.kind)).length;

/**
 * A title with its ticker picked out, for Trador's bold symbol: `["", "$FERRY", " graduated"]`.
 * The ticker is matched as written by the alert service (`$` and the symbol); a title without it
 * comes back whole.
 */
export function withTicker(title: string, symbol: string | null): readonly [string, string, string] {
  if (symbol === null || symbol === '') return [title, '', ''];
  const t = tickerText(symbol);
  const i = title.indexOf(t);
  return i < 0 ? [title, '', ''] : [title.slice(0, i), t, title.slice(i + t.length)];
}
