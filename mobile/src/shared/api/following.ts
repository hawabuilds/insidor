/**
 * THE FEED OF PEOPLE'S CALLS TO THE SOCIAL SERVICE: a page of the Feed, People to follow, and the
 * profile switch "Show my trades to followers". Through people.ts's signed, key-checked call, so
 * this file adds no network path of its own.
 *
 * Separate from people.ts so the Feed's reads and that file's alert calls change apart.
 *
 * ★ PERSONAL. Every answer here is about who the asker follows: it is never kept on the phone
 * between visits (the screen keeps it in memory only) and the service marks it no-store, so no
 * edge or browser cache holds it.
 */

import { notifyCall, socialCall, type ProfileCard } from './people.ts';
import type { FeedPage, SuggestedPerson } from './wire/following.ts';

export type { FeedCoin, FeedComment, FeedItem, FeedPage, FeedTrade, SuggestedPerson } from './wire/following.ts';

export type FeedTab = 'following' | 'top' | 'latest';
/** Top calls' window, as Trador's This week / All time. */
export type FeedWindow = 'week' | 'all';

export const fetchPeopleFeed = async (tab: FeedTab, cursor: string | null = null, window: FeedWindow = 'week'): Promise<FeedPage> =>
  (await socialCall('GET', `/feed?tab=${tab}${tab === 'top' ? `&window=${window}` : ''}${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`)) as FeedPage;

export const fetchPeopleToFollow = async (): Promise<readonly SuggestedPerson[]> => ((await socialCall('GET', '/feed/people')) as { people: readonly SuggestedPerson[] }).people;

/**
 * How many notifications are unread, for the Feed bell's dot: the alert service's own count
 * (GET /alerts/unread, the same count Notifications' bell rule uses), one number rather than the
 * whole list. Personal and no-store, through the signed notify call.
 */
export const fetchUnread = async (): Promise<number> => {
  const n = ((await notifyCall('GET', '/alerts/unread')) as { unread?: unknown }).unread;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
};

export const saveTradesPublic = async (on: boolean): Promise<ProfileCard> => (await socialCall('PUT', '/me', { tradesPublic: on })) as ProfileCard;
