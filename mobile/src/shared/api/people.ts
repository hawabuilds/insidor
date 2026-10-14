/**
 * PEOPLE AND ALERTS, AS THE PHONE APP HOLDS THEM — the client for services/social and
 * services/notify, and their shapes.
 *
 * ★ WHO IS ASKING TRAVELS AS THE SIGN-IN TOKEN, NOTHING ELSE. Each request carries the identity
 * token the wallet port hands out (`setTokenSource`, set once by App). The services read the
 * person — handle, wallet — from that signed token; nothing about the person is sent as data.
 *
 * ★ NO SAMPLE PEOPLE. Every call goes to the services — at VITE_SOCIAL_URL / VITE_NOTIFY_URL, or
 * the same-origin `/api/social` and `/api/notify` the dev server and the deploy forward. A
 * failure says it failed; an empty answer is an honest empty state. Never a made-up person.
 *
 * ★ PEOPLE'S WORDS ARE NOT CHECKED FOR OUR VOCABULARY, ONLY THE KEYS ARE. A comment may say
 * anything a person types; what must never appear is a field of ours that scores something.
 */

import { peopleRequest } from './client.ts';
import { FORBIDDEN_KEYS } from './wire/fields.ts';

export type { Alert, AlertPrefs, AlertSettings, AlertSwitch, Comment, CommentThread, LeaderRow, PersonRef, ProfileCard, RankId } from './wire/people.ts';
import type { Alert, AlertPrefs, AlertSettings, Comment, CommentThread, LeaderRow, PersonRef, ProfileCard } from './wire/people.ts';

const SOCIAL = (import.meta.env?.['VITE_SOCIAL_URL'] as string | undefined) || '/api/social';
const NOTIFY = (import.meta.env?.['VITE_NOTIFY_URL'] as string | undefined) || '/api/notify';

let tokenSource: () => string | null = () => null;
/** Called once by App with the wallet port's `sessionToken`. */
export function setTokenSource(source: () => string | null): void {
  tokenSource = source;
}

export class PeopleError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * A person's rank (Intern to GOAT) is the one forbidden word the people services may send: it is
 * the ladder people climb by their own likes and calls, shown on every profile and comment, not
 * the pipeline's ranking of posts that FORBIDDEN_KEYS bans the word for. Without this every
 * comment and profile was refused here, since each carries its author's rank.
 */
const PEOPLE_KEYS: readonly string[] = ['rank'];

/** Keys only: a person's words are theirs; a field of ours that scores something is a leak. */
function checkKeys(raw: unknown, path = '$'): void {
  if (Array.isArray(raw)) raw.forEach((x, i) => checkKeys(x, `${path}[${i}]`));
  else if (typeof raw === 'object' && raw !== null) {
    for (const [k, v] of Object.entries(raw)) {
      if (FORBIDDEN_KEYS.includes(k.toLowerCase()) && !PEOPLE_KEYS.includes(k.toLowerCase())) throw new PeopleError(500, `${path}.${k} is not something this app shows`);
      checkKeys(v, `${path}.${k}`);
    }
  }
}

async function call(service: 'social' | 'notify', method: string, path: string, body?: unknown): Promise<unknown> {
  const base = service === 'social' ? SOCIAL : NOTIFY;
  const response = await peopleRequest(`${base}${path}`, method, tokenSource(), body);
  const parsed = response.json;
  if (!response.ok) throw new PeopleError(response.status, typeof (parsed as { error?: unknown }).error === 'string' ? (parsed as { error: string }).error : 'That did not work. Try again.');
  checkKeys(parsed);
  return parsed;
}

const social = (method: string, path: string, body?: unknown) => call('social', method, path, body);
const notify = (method: string, path: string, body?: unknown) => call('notify', method, path, body);
/** The social service, signed and key-checked, for the owner's calls (shared/api/owner.ts). */
export const socialCall = social;
/** The alert service, signed and key-checked, for the post sheet's bell (shared/api/post-watch.ts). */
export const notifyCall = notify;

/* ── social ───────────────────────────────────────────────────────── */

export const syncMe = async (): Promise<ProfileCard> => (await social('POST', '/me')) as ProfileCard;
export const fetchMe = async (): Promise<ProfileCard> => (await social('GET', '/me')) as ProfileCard;
export const saveBio = async (bio: string): Promise<ProfileCard> => (await social('PUT', '/me', { bio })) as ProfileCard;
export const fetchProfile = async (key: string): Promise<{ profile: ProfileCard; comments: readonly Comment[] }> =>
  (await social('GET', `/profile/${encodeURIComponent(key)}`)) as { profile: ProfileCard; comments: readonly Comment[] };
export const fetchFollows = async (key: string, which: 'followers' | 'following'): Promise<readonly PersonRef[]> =>
  ((await social('GET', `/profile/${encodeURIComponent(key)}/${which}`)) as { people: readonly PersonRef[] }).people;
export const follow = async (userId: string, on: boolean): Promise<void> => void (await social(on ? 'POST' : 'DELETE', `/follow/${encodeURIComponent(userId)}`));
export const fetchComments = async (subject: string): Promise<CommentThread> => (await social('GET', `/comments?subject=${encodeURIComponent(subject)}`)) as CommentThread;
export const postComment = async (c: { subject: string; parentId: number | null; body: string; proofUrl: string | null }): Promise<Comment> =>
  ((await social('POST', '/comments', c)) as { comment: Comment }).comment;
export const likeComment = async (id: number, on: boolean): Promise<{ likes: number; earned?: number }> => (await social(on ? 'POST' : 'DELETE', `/comments/${id}/like`)) as { likes: number; earned?: number };
export const reportComment = async (id: number, reason: string): Promise<void> => void (await social('POST', `/comments/${id}/report`, { reason }));
export const hideComment = async (id: number): Promise<void> => void (await social('POST', `/comments/${id}/hide`));
export const fetchLeaderboard = async (): Promise<{ season: { id: number; endsAt: number }; rows: readonly LeaderRow[] }> =>
  (await social('GET', '/leaderboard')) as { season: { id: number; endsAt: number }; rows: readonly LeaderRow[] };

/* ── alerts ───────────────────────────────────────────────────────── */

/** Which side of the list, and which page: the Feed by tab (Rising bounded by `since`), or Notifications. */
export type AlertListAsk = { readonly list: 'notifications' } | { readonly list: 'feed'; readonly tab: 'latest' | 'rising' | 'watching'; readonly since?: number };
export interface AlertPage {
  readonly unread: number;
  /** Every unread notification (a server from before paging sends none). */
  readonly bell?: number;
  /** When the list was last marked read, ms; 0 when never. */
  readonly seenAt?: number;
  readonly alerts: readonly Alert[];
  /** The next page's cursor; null or absent at the end. */
  readonly cursor?: string | null;
}
/** One page of alerts, Notifications' first unless asked otherwise. */
export const fetchAlerts = async (ask: AlertListAsk = { list: 'notifications' }, cursor: string | null = null): Promise<AlertPage> => {
  const q = new URLSearchParams({ list: ask.list });
  if (ask.list === 'feed') {
    q.set('tab', ask.tab);
    if (ask.since !== undefined) q.set('since', String(Math.round(ask.since)));
  }
  if (cursor !== null) q.set('cursor', cursor);
  return (await notify('GET', `/alerts?${q.toString()}`)) as AlertPage;
};
export const markAlertsSeen = async (): Promise<void> => void (await notify('POST', '/alerts/seen'));
export const fetchAlertSettings = async (): Promise<AlertSettings> => (await notify('GET', '/prefs')) as AlertSettings;
export const saveAlertPrefs = async (prefs: AlertPrefs): Promise<AlertSettings> => (await notify('PUT', '/prefs', { prefs })) as AlertSettings;
export const registerDevice = async (sub: { endpoint: string; keys: { p256dh: string; auth: string }; device?: string }): Promise<void> => void (await notify('POST', '/push/subscribe', sub));
export const unregisterDevice = async (endpoint: string): Promise<void> => void (await notify('DELETE', '/push/subscribe', { endpoint }));
export const sendTestPush = async (): Promise<{ sent: number; devices?: number; why: string | null }> => (await notify('POST', '/push/test')) as { sent: number; devices?: number; why: string | null };
export const syncWatch = async (stories: readonly string[]): Promise<void> => void (await notify('PUT', '/watch', { stories }));
