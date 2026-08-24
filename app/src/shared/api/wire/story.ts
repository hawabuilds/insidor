/**
 * THE STORY — one meme, the posts that carry it, the coins minted from it, and what people
 * are saying.
 *
 * Evidence is the part that has to be honest. It is the list of posts that made us call this
 * one thing, and it is the only place a user can check our work. So each piece carries who
 * posted it, when, and where — and NOT how much it contributed to any internal number. "This
 * post scored 0.83 on the carrier join" is exactly the sentence this wire vocabulary exists
 * to make unsayable.
 */

import type { Instant, Measured, Delta } from '../../format/measure.ts';
import type { CoinLink } from './coin.ts';
import type { Spark, Tone } from './board.ts';

/**
 * A post we counted as part of this story.
 *
 * `sourceLabel` is a display string chosen by the server ("X", "TikTok", "Reddit"). The app
 * never maps an internal source id to a label, because that mapping is a place where a new
 * platform silently renders as its raw id.
 */
export interface Evidence {
  readonly evidenceId: string;
  readonly sourceLabel: string;
  readonly authorLabel: string;
  readonly permalink: string;
  readonly excerpt: string;
  readonly thumbUrl: string | null;
  readonly postedAt: Instant;
  /** Why this post is in the story, in plain English, written by the server. */
  readonly relation: string;
}

/**
 * Something a person said about this story, on our surface.
 *
 * Deliberately thin. This is a discussion, not a social network: no reply trees, no scores,
 * no ordering signal the client can act on.
 */
export interface DiscussionPost {
  readonly postId: string;
  readonly authorLabel: string;
  readonly text: string;
  readonly postedAt: Instant;
}

export interface Story {
  readonly id: string;
  readonly title: string;
  readonly summary: readonly [string, string];
  readonly thumbUrl: string | null;

  readonly reach: Measured;
  /**
   * The one field on this page permitted to carry colour, and only by sign. It is a fact,
   * so it stays; the discipline is in `ui/Delta.tsx`, which takes no numeric colour input.
   * This is the honest weak spot of the whole scheme, and it is labelled rather than hidden.
   */
  readonly reachDelta24h: Delta;
  readonly spark: Spark;
  readonly momentum: Tone | null;
  readonly firstSeenAt: Instant;

  readonly coins: CoinLink;
  readonly evidence: readonly Evidence[];
  readonly discussion: readonly DiscussionPost[];
  /**
   * ★ WHETHER THIS STORY HAPPENED.
   *
   * The board carries the same statement about a whole frame; a reader who clicked a row
   * used to land here, on the same six invented numbers, with nothing over them. Two
   * surfaces, one fiction, a notice on only one of them.
   *
   * It is on the PAGE and not borrowed from the board because this page is reachable
   * without one — a shared link, a bookmark, a cold open — and a page that could only be
   * honest when clicked through from the list would be dishonest exactly where the reader
   * has the least context.
   *
   * It is not "how this story was assembled", which stays ours: no member weights, no
   * match confidence, nothing about what joined what. Only whether there is a world behind
   * the row.
   */
  readonly provenance: StoryProvenance;
}

/**
 * ★ `unstated` IS NOT `observed`, for the reason the board's copy gives at length: an
 * absent field must never resolve to the answer that makes the app say nothing.
 */
export type StoryProvenance =
  | { readonly kind: 'observed' }
  | { readonly kind: 'seeded'; readonly connectSourceLabel: string }
  | { readonly kind: 'unstated' };
