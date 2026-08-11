/**
 * The mint feed port, and the one thing this process is for.
 *
 * ON TRANSPORT, because the documents disagree with themselves and the
 * disagreement has already been adjudicated. The architecture calls chainwatch
 * "the one long-lived connection"; the stack document corrects that to "the one
 * long-lived PROCESS" and gives the arithmetic: a streaming plan is ~$499/month
 * against a total infrastructure budget near $130, to buy 30 seconds on a window
 * whose median time-to-peak is six days. So the shipped transport is a 20-second
 * poll over a durable cursor, and `transport` is a field rather than an
 * assumption so a stream can be substituted without touching anything below.
 *
 * Nothing in this file, in coverage.ts or in main.ts cares which it is. The
 * supervision, the backoff and the gap detection are transport-agnostic on
 * purpose: a dropped socket and a failing poll are the same event — an interval
 * during which we were not watching — and there is exactly one piece of code
 * that decides what that means.
 *
 * `pageFull` is the field people leave out. A read that returns exactly the
 * limit is a read that cannot prove it saw everything, and a missed mint is a
 * lead-time claim we would not be able to honour.
 */

import type { AssetRef, MintTime, Millis } from '@insidor/contracts';

import type { Gap } from './coverage.ts';
import type { MintCursor } from './cursor.ts';

/**
 * A mint as this process saw it. Symbol and name are OBSERVED strings, never
 * identifiers: the resolver scores them, and one meme can spawn 306 tokens
 * sharing a symbol.
 */
export interface ObservedMint {
  readonly ref: AssetRef;
  readonly venueId: string;
  /** Carries its own source and confidence. A vendor field can never be exact. */
  readonly mintedAt: MintTime;
  readonly symbol: string | null;
  readonly name: string | null;
  readonly creator: string | null;
  /** Attacker-controlled. The field name says so, and so does the column. */
  readonly declaredSocial: unknown;
  readonly firstSeenAt: Millis;
}

export interface MintFeedPage {
  /** When we started the read. */
  readonly from: Millis;
  /** When the read completed. Coverage extends to here and never further. */
  readonly to: Millis;
  readonly mints: readonly ObservedMint[];
  /** The source returned `limit` rows: there may be more we did not see. */
  readonly pageFull: boolean;
  /** Where to resume. Persisted only after the mints above are stored. */
  readonly cursor: MintCursor;
}

export interface MintFeed {
  readonly id: string;
  readonly transport: 'poll' | 'stream';
  read(from: MintCursor, limit: number, signal: AbortSignal): Promise<MintFeedPage>;
}

/** Where the mints and the gaps go. Implemented in wiring.ts against store. */
export interface MintSink {
  /** Must be durable before the cursor advances past these rows. */
  recordMints(mints: readonly ObservedMint[]): Promise<void>;
  /**
   * A gap row. Separate from `recordMints` because a gap is not an absence of
   * mints — it is a statement that the question cannot be answered for that
   * window, and the labeller reads it to mark outcomes censored.
   */
  recordGap(gap: Gap): Promise<void>;
}
