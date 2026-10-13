/**
 * WHAT OTHER PEOPLE POSTED UNDER A POST: its replies and its reproductions (posts that carry it
 * inside their own), as read from the source, in the source's own words.
 *
 * Its own file, beside the platform port, because it is a different read with a different bill:
 * one post's conversation, paid per post returned, asked of the few posts that clear the feed's
 * reach bar. Core turns these into facts (core/src/qualify/attention.ts); nothing here scores.
 *
 * ★ A RESPONSE IS NOT A COUNT. The source's reply and reproduction counters are already on the
 * Item; this is the text and the account behind each response, because the facts the owner asked
 * for ("a ticker in the replies", "crypto accounts noticed it") live in the words, not the totals.
 *
 * ★ `cut` IS THE SOURCE'S WORD THAT MORE EXIST THAN WERE READ. A capped read is a sample of the
 * newest responses, never "all of them": a fact counted from it is "at least", and a reader that
 * forgot that would call a post with 900 replies "two tickers seen".
 *
 * What breaks if changed carelessly: `at` must be the response's own post time, never the time we
 * read it. The "before the coin launched" test filters on it, and a read time would put every
 * reply of a week-old post after its coin.
 */

import type { Millis } from '../vocabulary.ts';

/** One reply or reproduction, as the source gave it. Every field the source may omit is null. */
export interface ResponsePost {
  readonly sourceItemId: string;
  /** When it was posted, from the source. Null when unreadable. */
  readonly at: Millis | null;
  readonly text: string;
  /** The account's handle, name and profile text: what "a crypto account" is read from. */
  readonly authorHandle: string | null;
  readonly authorName: string | null;
  readonly authorBio: string | null;
}

export interface PostResponses {
  readonly replies: readonly ResponsePost[];
  readonly reproductions: readonly ResponsePost[];
  /** The source said more replies exist than were read. */
  readonly repliesCut: boolean;
  readonly reproductionsCut: boolean;
}

export interface ResponseAsk {
  /** At most this many of each, newest first. */
  readonly maxReplies: number;
  readonly maxReproductions: number;
  /** Only responses posted before this instant; null for any time. */
  readonly untilMs: Millis | null;
}
