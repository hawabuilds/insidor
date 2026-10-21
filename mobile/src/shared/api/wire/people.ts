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
  /** Withheld (null) when their portfolio is private, as Trador withholds it; always theirs to see. */
  readonly wallet: string | null;
  /** Whether the portfolio is on the profile: shown, private (switched off), or no wallet yet. */
  readonly portfolio: 'shown' | 'private' | 'no_wallet';
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
  /** "Show my trades to followers": theirs to see only, so null on anyone else's profile. */
  readonly tradesPublic?: boolean | null;
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
  /** A row about a post: our stored copy of its poster's picture, by file name, tried before `picture`. */
  readonly pictureFile?: string | null;
  /** The coin the alert is about, by address, for its logo; null or absent when it is about no coin. */
  readonly coin?: string | null;
  /** A follow's follower, and whether you already follow them back; null or absent on other rows. */
  readonly actor?: { readonly userId: string; readonly handle: string | null; readonly name: string | null; readonly iFollow: boolean } | null;
  /** Sent to this person's phone as a push: then it is listed in Notifications too, whatever its kind. Absent from an older service. */
  readonly pushed?: boolean;
  /** The post's or narrative's picture beside the row (a video's cover with `video`), and the post's site label for its badge. */
  readonly thumb?: { readonly url: string; readonly video: boolean; readonly sourceLabel: string | null } | null;
  /** A row about a post: that post's For You card as the read service sends it, decoded by the screen (decodeRisingPost). */
  readonly post?: unknown;
  /** A post blowing up: the views it gained over the last `minutes`. */
  readonly speed?: { readonly gain: number; readonly minutes: number } | null;
  /** A narrative's row (`story` on the wire: `narrative` is a key the app refuses): its title, the last hour's new posts and views, and whether you starred it. */
  readonly story?: { readonly title: string; readonly newPosts: number | null; readonly viewsGained: number | null; readonly starred: boolean } | null;
}

export type AlertSwitch = 'follows' | 'replies' | 'useful' | 'holdings' | 'watchlist' | 'graduations' | 'rising' | 'narratives' | 'coins' | 'fypCoins' | 'proven' | 'storyCoins' | 'watchedPosts' | 'starredFirstCoin' | 'blowingUp' | 'starredSpeed' | 'bigAccounts' | 'createdCoins' | 'launches';
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
  readonly push: {
    readonly on: boolean;
    readonly configured: boolean;
    readonly publicKey: string | null;
    /** Devices saved for this person on the server. */
    readonly devices: number;
    /** What the push service said to the last push to one of them, and its status code; null before any, or from an older service. */
    readonly last?: { readonly result: 'taken' | 'refused' | 'no-answer'; readonly status: number; readonly at: number } | null;
  };
}

