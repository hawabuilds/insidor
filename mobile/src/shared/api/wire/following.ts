/**
 * THE FEED OF PEOPLE, AS THE PHONE APP HOLDS IT — the social service's GET /feed and
 * GET /feed/people (services/social activity.ts), apart from the client so tests can build them.
 *
 * Separate from wire/people.ts because these are a page of two kinds of thing merged by time,
 * and the Feed is the only screen that reads them.
 *
 * ★ NO AMOUNTS, AS TRADOR. A trade carries where a buy stood (the market cap when it landed) or
 * how a sell went (profit or loss against the seller's average buy), and never what anyone spent.
 */

import type { PersonRef } from './people.ts';

/** What the Feed knows of a coin: names and a picture when we have seen it, its address always. */
export interface FeedCoin {
  readonly mint: string;
  readonly symbol: string | null;
  readonly name: string | null;
  readonly imageUrl: string | null;
}

export interface FeedTrade {
  readonly kind: 'trade';
  readonly key: string;
  readonly at: number;
  readonly person: PersonRef;
  readonly side: 'buy' | 'sell';
  readonly coin: FeedCoin;
  /** A buy's coin market cap when it landed, in USD; null for a sell, or when no reading was that close. */
  readonly marketCapUsd: number | null;
  /** A sell against the seller's own average buy; null for a buy, or when either side is not known. */
  readonly outcome: 'profit' | 'loss' | null;
  readonly signature: string | null;
}

export interface FeedComment {
  readonly kind: 'comment';
  readonly key: string;
  readonly at: number;
  readonly person: PersonRef;
  readonly commentId: number;
  readonly body: string;
  readonly likes: number;
  readonly likedByMe: boolean;
  readonly replies: number;
  /** What it was said on: a coin, a group of posts (story) or one post, with its title when known. */
  readonly on: {
    readonly kind: 'coin' | 'story' | 'post';
    readonly id: string;
    readonly storyId: string | null;
    readonly title: string | null;
    readonly coin: FeedCoin | null;
    /** A post's small picture or video cover, or a narrative's picture; null when there is none. */
    readonly pictureUrl: string | null;
    /** The post's picture is a still of a video. */
    readonly video: boolean;
    /** The post's site as For You labels it ("X", "TikTok"). */
    readonly site: string | null;
    /** The post's author, "@handle". */
    readonly author: string | null;
    /** The author's face: our stored copy's file name and the source's link (absent from an older service). */
    readonly authorPictureFile?: string | null;
    readonly authorPictureUrl?: string | null;
  };
}

export type FeedItem = FeedTrade | FeedComment;

export interface FeedPage {
  readonly items: readonly FeedItem[];
  readonly cursor: string | null;
  /** How many people the asker follows: zero is the People to follow screen. */
  readonly following: number;
}

/** Someone to follow, with this week's counts. `tradesThisWeek` is null when they do not share trades. */
export interface SuggestedPerson extends PersonRef {
  readonly followers: number;
  readonly likesThisWeek: number;
  readonly tradesThisWeek: number | null;
  readonly commentsThisWeek: number;
}
