/**
 * THE STORY — one meme, the posts that carry it, the coins minted from it, and what people
 * are saying.
 *
 * Evidence is the part that has to be honest. It is the list of posts that made us call this
 * one thing, and it is the only place a user can check our work. So each piece carries who
 * posted it, when, and where — and NOT how much it contributed to any internal number. "This
 * post scored 0.83 on the carrier join" is exactly the sentence this wire vocabulary exists
 * to make unsayable.
 *
 * ★ A COPY OF `app/src/shared/api/wire/story.ts`, KEPT IN STEP BY HAND. The phone app reads the
 * same read service and must agree with the desktop app about what it sends, but it may not
 * import the desktop package (.dependency-cruiser.cjs, `mobile-cannot-reach-the-logic`). If
 * the wire changes, both copies change in the same commit.
 */

import type { Instant, Measured, Delta, Millis, PendingReason } from '../../format/measure.ts';
import type { CoinLink } from './coin.ts';
import type { BoardProvenance, Spark, Tone } from './board.ts';

/**
 * The earliest post in the story we found: when, by whom, and a link. `startedBy` is set
 * only when it is proven — later posts in the story quote it ('quoted'), or it carries the
 * same picture ('samePicture') — and "Started by" is said only then. `posted` is pending,
 * with the server's reason, when no post in the story carries a time.
 */
export type EarliestPost =
  | { readonly known: false; readonly pending: PendingReason }
  | {
      readonly known: true;
      readonly at: Millis;
      readonly authorLabel: string;
      readonly permalink: string | null;
      readonly startedBy: 'quoted' | 'samePicture' | null;
    };

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

/** A narrative's size, as the server names it. */
export type NarrativeStage = 'early' | 'forming' | 'big';

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
  /** The earliest post in the story we hold. See `EarliestPost`. */
  readonly earliestPost: EarliestPost;

  readonly coins: CoinLink;
  readonly evidence: readonly Evidence[];
  /**
   * Early, Forming or Big: the server's name for two counts this page already shows — the
   * posts listed and its top post's views. Null when the server sent none (an older frame).
   */
  readonly stage: NarrativeStage | null;
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

/** The Narratives list: the board's stories as whole pages, with the board's provenance. */
export interface NarrativesList {
  readonly tick: number;
  readonly stories: readonly Story[];
  readonly provenance: BoardProvenance;
}
