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
import type { Coin, CoinLink } from './coin.ts';
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
  /**
   * Views the narrative gained over about the last hour, summed by the projector under the rule in
   * mobile/src/features/narrative/story-views.ts. Null when the server sends none (it does not yet);
   * a Measured with its reason when it sends one it could not say. The Narratives tab's order.
   * ★ PHONE ONLY FOR NOW: the desktop copy gains it when the desktop shows it.
   */
  readonly viewsGained1h: Measured | null;
  /** How many of the posts `viewsGained1h` counted (those known at both ends of the hour). */
  readonly viewsGained1hPosts: number | null;
  /** Each post's newest views, summed by the projector; `viewsTotalPosts` of `postCount` had one. */
  readonly viewsTotal: Measured | null;
  readonly viewsTotalPosts: number | null;
  /**
   * The views it gained every five minutes over the day (`values[i]` is the slot starting at
   * `fromMs + i * stepMs`), each post's gain spread evenly between its own readings and added up by
   * the projector; null in a slot no post was being read in. Null when the server sends no series.
   */
  readonly viewsGained: ViewsGained | null;
  /** The same gains from its first reading to now in half-hours: the page's "All" line. Null from an older server. */
  readonly viewsGainedAll: ViewsGained | null;
  /** Each listed post's newest views, its own last-hour gain and when we found it, by post id. Null from an older server. */
  readonly postViews: ReadonlyMap<string, PostViews> | null;
  /**
   * The Narratives tab's orders by window, keyed by hours (1, 6, 24): views gained in it, posts
   * found in it, and its place in Trending for it (1 first). The place is a position, nothing more.
   * Null from an older server.
   */
  readonly inWindow: ReadonlyMap<number, InWindow> | null;
  /** The top coin when none is settled: shown only as "Top coin, not checked", never as its coin. */
  readonly topCoin: Coin | null;
  /** How many posts the page lists, as the server counts them. */
  readonly postCount: number | null;
  /** We found it: the earliest moment we saved any post it lists now. Null from a server that does not say. */
  readonly foundAt: Instant | null;
  /** No post it lists went up in the last 48 hours: left out of Trending, still in Most viewed and New. False from a server that does not say. */
  readonly dead: boolean;
}

export interface ViewsGained {
  readonly fromMs: number;
  readonly stepMs: number;
  readonly values: readonly (number | null)[];
}

export interface PostViews {
  readonly views: number | null;
  readonly gainedLastHour: number | null;
  /** When we first saved the post; null when the server did not say. */
  readonly foundAt: number | null;
}

export interface InWindow {
  readonly viewsGained: Measured;
  readonly newPosts: number;
  /** Its place in Trending for the window; null for a dead narrative, which is not in Trending. */
  readonly trendingPlace: number | null;
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
/** One page of the All time list (GET /narratives/:view/all): `next` is the next page's offset, null on the last. */
export interface NarrativesPage {
  readonly stories: readonly Story[];
  readonly provenance: BoardProvenance;
  readonly next: number | null;
}

export interface NarrativesList {
  readonly tick: number;
  readonly stories: readonly Story[];
  readonly provenance: BoardProvenance;
}
