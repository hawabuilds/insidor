/**
 * One single post on the For You, Popular or News feed, as `GET /rising/:feedId` sends it.
 *
 * Facts only — where and by whom it was posted, a link to it, its words and picture, when it
 * was posted, how many saw it and when we read that, and the views line. Our reasoning about
 * it (the score that let it onto the feed) is not on the wire and has no field here.
 *
 * ★ EVERY POST SAYS WHERE ITS COIN STANDS, AND A COIN ONLY COMES THROUGH A NARRATIVE. `coins`
 * is the story's own link when the post is part of a narrative that names one coin, several,
 * or cannot tell which (`storyId` then names it); otherwise it is the post's own search: `none`
 * when its name was searched and nothing came back, `unsure` when coins came back, `pending`
 * when it has not been searched yet, `unchecked` ("Couldn't check") when its search failed on
 * every source for minutes after it reached the feed. A `one` or `several` link without its narrative is refused
 * by the decoder (decode.ts, `decodeRisingPost`), so Buy only ever shows a narrative's answer.
 *
 * ★ `runningOlder` IS NEVER THE POST'S COIN. Coins launched before the post, named for its
 * subject, whose trading jumped since it (services/project older-coins.ts): what they traded, in
 * dollars, and how their price moved. Each carries an address that opens its own token page and
 * nothing a Buy on the card could be built from; empty when none, and on a row from before the
 * field existed.
 */

import type { Instant, Measured } from '../../format/measure.ts';
import type { Spark } from './board.ts';
import type { PostCoinLink } from './coin.ts';

/** `news` is news posts with a coin in them; `fyp` and `popular` are memes only (services/project news.ts). */
export type RisingFeedId = 'fyp' | 'popular' | 'news';

export interface RisingPost {
  readonly id: string;
  readonly sourceLabel: string;
  readonly authorLabel: string;
  /** Null when the server holds no handle to build one from — never a guessed link. */
  readonly permalink: string | null;
  readonly excerpt: string;
  readonly thumbUrl: string | null;
  /** The picture is a still of the post's video (an X preview, a TikTok cover): it gets a play icon. */
  readonly thumbIsVideo: boolean;
  readonly postedAt: Instant;
  readonly reach: Measured;
  readonly readAt: Instant;
  readonly spark: Spark;
  readonly storyId: string | null;
  readonly coins: PostCoinLink;
  /** Older coins named for the subject, trading more since the post; busiest first. */
  readonly runningOlder: readonly OlderCoin[];
}

/** An older coin whose trading jumped since a post. Facts about its market, nothing about us. */
export interface OlderCoin {
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  /** When its market began, as the market source reported it: before the post. */
  readonly launchedAt: Instant;
  /** Dollars traded per hour over the day before the post. */
  readonly hourBeforeUsd: Measured;
  /** The busiest hour since the post, in dollars. */
  readonly peakHourUsd: Measured;
  /** The price since against the price at the post, as a fraction (-0.25 is down a quarter); null when unknown. */
  readonly priceChangeSincePost: number | null;
  readonly readAt: Instant;
}

export interface RisingFeed {
  readonly tick: number;
  /** In the server's committed order. The client never sorts. */
  readonly posts: readonly RisingPost[];
}
