/**
 * THE FEED OF PEOPLE, AS THE PHONE APP HOLDS IT — the social service's GET /feed and
 * GET /feed/people (services/social activity.ts), apart from the client so tests can build them.
 *
 * Separate from wire/people.ts because these are a page of two kinds of thing merged by time,
 * and the Feed is the only screen that reads them.
 *
 * ★ A TRADE'S SOL IS THE QUOTE. `quotedLamports` is what was quoted before slippage, never the
 * fill; the screen writes "about" in front of it. There is no profit field and must not be one:
 * the service does not have the fill to compute it from.
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
  /** SOL in (a buy) or out (a sell) as quoted, in lamports; null when the record has none. */
  readonly quotedLamports: string | null;
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
  readonly on: { readonly kind: 'coin' | 'story' | 'post'; readonly id: string; readonly storyId: string | null; readonly title: string | null; readonly coin: FeedCoin | null };
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
