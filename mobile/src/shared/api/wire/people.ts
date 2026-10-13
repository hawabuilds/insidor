/**
 * The social and alert services' replies, as the phone app holds them (services/social,
 * services/notify), apart from the client so tests can build them without it.
 */

export type RankId = 'intern' | 'analyst' | 'quant' | 'wolf' | 'goat';

export interface PersonRef {
  readonly userId: string;
  readonly handle: string | null;
  readonly name: string | null;
  readonly pictureUrl: string | null;
  readonly rank: RankId;
}

export interface ProfileCard extends Omit<PersonRef, 'rank'> {
  readonly bio: string;
  readonly wallet: string | null;
  readonly rank: RankId;
  readonly rep: number;
  readonly next: { readonly rank: RankId; readonly repToGo: number } | null;
  readonly topOfSeason: boolean;
  readonly season: { readonly id: number; readonly endsAt: number };
  readonly followers: number;
  readonly following: number;
  readonly iFollow: boolean;
  readonly followsMe: boolean;
  readonly isMe: boolean;
}

export interface Comment {
  readonly id: number;
  readonly parentId: number | null;
  readonly subject: string;
  readonly author: PersonRef;
  readonly body: string;
  readonly proofUrl: string | null;
  readonly proof: boolean;
  readonly likes: number;
  readonly likedByMe: boolean;
  readonly mine: boolean;
  readonly at: number;
}

export interface CommentThread {
  readonly subject: string;
  /** The coin whose holders may like; null when likes are closed for this subject. */
  readonly coin: string | null;
  readonly comments: readonly Comment[];
}

export interface LeaderRow extends PersonRef {
  readonly position: number;
  readonly rep: number;
  readonly isMe: boolean;
}

export interface Alert {
  readonly id: number;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly href: string;
  readonly at: number;
  readonly unread: boolean;
  readonly symbol: string | null;
  readonly rank: string | null;
  readonly season: number | null;
  /** The face for the row: the person's or the poster's picture (https); null or absent when there is none. */
  readonly picture?: string | null;
  /** The coin the alert is about, by address, for its logo; null or absent when it is about no coin. */
  readonly coin?: string | null;
  /** A follow's follower, and whether you already follow them back; null or absent on other rows. */
  readonly actor?: { readonly userId: string; readonly handle: string | null; readonly name: string | null; readonly iFollow: boolean } | null;
}

export type AlertSwitch = 'follows' | 'replies' | 'useful' | 'holdings' | 'watchlist' | 'graduations' | 'rising' | 'narratives' | 'coins';
export interface AlertPrefs {
  readonly muted: boolean;
  readonly on: Readonly<Record<AlertSwitch, boolean>>;
  readonly multiples: readonly number[];
  readonly quietStart: string | null;
  readonly quietEnd: string | null;
  readonly timezone: string;
  readonly perHour: number;
}
export interface AlertSettings {
  readonly prefs: AlertPrefs;
  readonly multiplesOffered: readonly number[];
  readonly maxPerHour: number;
  readonly push: { readonly on: boolean; readonly configured: boolean; readonly publicKey: string | null; readonly devices: number };
}

