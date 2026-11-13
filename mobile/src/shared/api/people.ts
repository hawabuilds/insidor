/**
 * PEOPLE AND ALERTS, AS THE PHONE APP HOLDS THEM — the client for services/social and
 * services/notify, and their shapes.
 *
 * ★ WHO IS ASKING TRAVELS AS THE SIGN-IN TOKEN, NOTHING ELSE. Each request carries the identity
 * token the wallet port hands out (`setTokenSource`, set once by App). The services read the
 * person — handle, wallet — from that signed token; nothing about the person is sent as data.
 * The token lives hours, the session weeks, so each call takes it renewed when near its end, and a
 * 401 is renewed and asked once more: a phone left open overnight is never told to sign in again.
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

export type { Alert, AlertPrefs, AlertSettings, AlertSwitch, Comment, CommentThread, FoundPerson, LeaderRow, PersonRef, ProfileCard, RankId } from './wire/people.ts';
import type { Alert, AlertPrefs, AlertSettings, Comment, CommentThread, FoundPerson, LeaderRow, PersonRef, ProfileCard } from './wire/people.ts';

const SOCIAL = (import.meta.env?.['VITE_SOCIAL_URL'] as string | undefined) || '/api/social';
const NOTIFY = (import.meta.env?.['VITE_NOTIFY_URL'] as string | undefined) || '/api/notify';

export interface TokenSource {
  /** The token as it stands, read without waiting. */
  readonly held: () => string | null;
  /** The token renewed first when near its end; `force` renews whatever it says. */
  readonly fresh: (force: boolean) => Promise<string | null>;
}
let tokenSource: TokenSource = { held: () => null, fresh: async () => null };
/** Called once by App with the wallet port's `sessionToken` and `freshSessionToken`. */
export function setTokenSource(source: TokenSource): void {
  tokenSource = source;
}
/** The session token as it stands, for a screen that keeps what it read per person (features/alerts keep.ts). Never sent anywhere by that caller. */
export const sessionToken = (): string | null => tokenSource.held();

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

async function call(service: 'social' | 'notify', method: string, path: string, body?: unknown, keepalive = false): Promise<unknown> {
  const base = service === 'social' ? SOCIAL : NOTIFY;
  const token = await tokenSource.fresh(false);
  let response = await peopleRequest(`${base}${path}`, method, token, body, keepalive);
  /* Refused while signed in: the token may have run out between the check and the service. Renewed once and asked again, never in a loop. */
  if (response.status === 401 && token !== null) {
    const renewed = await tokenSource.fresh(true);
    if (renewed !== null && renewed !== token) response = await peopleRequest(`${base}${path}`, method, renewed, body, keepalive);
  }
  const parsed = response.json;
  if (!response.ok) throw new PeopleError(response.status, typeof (parsed as { error?: unknown }).error === 'string' ? (parsed as { error: string }).error : 'That did not work. Try again.');
  checkKeys(parsed);
  return parsed;
}

const social = (method: string, path: string, body?: unknown, keepalive = false) => call('social', method, path, body, keepalive);
const notify = (method: string, path: string, body?: unknown) => call('notify', method, path, body);
/** The social service, signed and key-checked, for the owner's calls (shared/api/owner.ts). */
export const socialCall = social;
/** The alert service, signed and key-checked, for the post sheet's bell (shared/api/post-watch.ts). */
export const notifyCall = notify;

/* ── social ───────────────────────────────────────────────────────── */

/**
 * The post sheet was opened: ask for a fresh view reading of the post (services/social reading-ask.ts).
 * Open to signed-out viewers. Whether a reading is taken is the server's call; nothing waits on it.
 */
export const askForReading = async (postId: string): Promise<void> => void (await social('POST', `/post/${encodeURIComponent(postId)}/reading`));
/** Brings the profile up to date; `pictureUrl` is the sign-in's X picture, kept by the server only when it is X's own picture host. */
export const syncMe = async (pictureUrl: string | null = null): Promise<ProfileCard> => (await social('POST', '/me', pictureUrl === null ? undefined : { pictureUrl })) as ProfileCard;
export const fetchMe = async (): Promise<ProfileCard> => (await social('GET', '/me')) as ProfileCard;
export const saveBio = async (bio: string): Promise<ProfileCard> => (await social('PUT', '/me', { bio })) as ProfileCard;
/** Edit profile's words: the name shown ('' goes back to the sign-in's) and the bio. */
export const saveProfile = async (p: { readonly name: string; readonly bio: string }): Promise<ProfileCard> => (await social('PUT', '/me', p)) as ProfileCard;
/** Edit profile's picture or banner, as a data URL the service checks for type and size; the stored file's name. */
export const uploadProfileImage = async (kind: 'picture' | 'banner', image: string): Promise<string | null> => {
  const r = (await social('POST', `/me/${kind}`, { image })) as Record<string, unknown>;
  const file = r[kind === 'picture' ? 'pictureFile' : 'bannerFile'];
  return typeof file === 'string' ? file : null;
};
/** Back to the X picture, or the default banner. */
export const clearProfileImage = async (kind: 'picture' | 'banner'): Promise<void> => void (await social('DELETE', `/me/${kind}`));
export const fetchProfile = async (key: string): Promise<{ profile: ProfileCard; comments: readonly Comment[] }> => {
  const raw = (await social('GET', `/profile/${encodeURIComponent(key)}`)) as { profile: unknown; comments: readonly Comment[] };
  return { profile: decodeProfileWallet(raw.profile), comments: raw.comments };
};

/**
 * A profile's wallet and whether its portfolio shows, read strictly: `portfolio` is one of three
 * words, and a wallet comes only with `shown` and a Solana address. A profile that says private
 * yet carries a wallet is refused rather than shown, so a server slip cannot publish a portfolio
 * its owner hid. The rest of the card is the social service's, as before.
 */
export function decodeProfileWallet(raw: unknown): ProfileCard {
  if (typeof raw !== 'object' || raw === null) throw new PeopleError(500, 'profile is not an object');
  const o = raw as Record<string, unknown>;
  const portfolio = o['portfolio'];
  if (portfolio !== 'shown' && portfolio !== 'private' && portfolio !== 'no_wallet') throw new PeopleError(500, 'profile.portfolio is not a known value');
  const wallet = o['wallet'];
  if (portfolio === 'shown') {
    if (typeof wallet !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) throw new PeopleError(500, 'profile.wallet is not an address');
  } else if (wallet !== null) {
    throw new PeopleError(500, 'profile.wallet came with a portfolio that is not shown');
  }
  return { ...(o as unknown as ProfileCard), portfolio, wallet };
}
export const fetchFollows = async (key: string, which: 'followers' | 'following'): Promise<readonly PersonRef[]> =>
  ((await social('GET', `/profile/${encodeURIComponent(key)}/${which}`)) as { people: readonly PersonRef[] }).people;
export const follow = async (userId: string, on: boolean): Promise<void> => void (await social(on ? 'POST' : 'DELETE', `/follow/${encodeURIComponent(userId)}`));
/** People by handle or name, for Search's people strip; open signed out, which then shows no one as followed. */
export const searchPeople = async (term: string): Promise<readonly FoundPerson[]> =>
  ((await social('GET', `/people/search?q=${encodeURIComponent(term)}`)) as { people: readonly FoundPerson[] }).people;
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
