/**
 * One single post on the For You or Popular feed, as `GET /rising/:feedId` sends it.
 *
 * Facts only — where and by whom it was posted, a link to it, its words and picture, when it
 * was posted, how many saw it and when we read that, and the views line. Our reasoning about
 * it (the score that let it onto the feed) is not on the wire and has no field here.
 *
 * ★ A COIN ONLY THROUGH A CONFIDENT NARRATIVE. `coin` is set only when the post is part of a
 * narrative whose board row names exactly one coin, and then `storyId` names that narrative.
 * Otherwise both are null, so no button can be assembled from a single post. The decoder
 * refuses any other shape (decode.ts, `decodeRisingPost`).
 */

import type { Instant, Measured } from '../../format/measure.ts';
import type { Spark } from './board.ts';
import type { Coin } from './coin.ts';

export type RisingFeedId = 'fyp' | 'popular';

export interface RisingPost {
  readonly id: string;
  readonly sourceLabel: string;
  readonly authorLabel: string;
  /** Null when the server holds no handle to build one from — never a guessed link. */
  readonly permalink: string | null;
  readonly excerpt: string;
  readonly thumbUrl: string | null;
  readonly postedAt: Instant;
  readonly reach: Measured;
  readonly readAt: Instant;
  readonly spark: Spark;
  readonly storyId: string | null;
  readonly coin: Coin | null;
}

export interface RisingFeed {
  readonly tick: number;
  /** In the server's committed order. The client never sorts. */
  readonly posts: readonly RisingPost[];
}
