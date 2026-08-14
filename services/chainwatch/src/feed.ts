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

import type { Millis, MintEvent } from '@insidor/contracts';

import type { Gap } from './coverage.ts';
import type { MintCursor } from './cursor.ts';

/*
 * A mint is a `MintEvent` from the vocabulary — asset, venue, mint time, seen-at —
 * and this file deliberately declares no shape of its own for one. An earlier
 * draft had a local `ObservedMint` that re-spelled the same facts (`venueId` for
 * `venue`, `declaredSocial: unknown` for the record of claimed links, no `key` and
 * no `chain`), and a second spelling of the vocabulary inside a service is how the
 * vocabulary stops being shared. The supervision types BELOW have no contract
 * equivalent and so are local: a coverage-bearing page and a durable cursor are
 * facts about this process, not about a venue.
 */

export interface MintFeedPage {
  /** When we started the read. */
  readonly from: Millis;
  /** When the read completed. Coverage extends to here and never further. */
  readonly to: Millis;
  readonly mints: readonly MintEvent[];
  /** The source returned `limit` rows: there may be more we did not see. */
  readonly pageFull: boolean;
  /**
   * ★ Windows INSIDE [from, to] that this read cannot vouch for. Usually empty.
   *
   * Every other field here describes a read as a single event: it started, it
   * finished, it was or was not complete. That is the whole truth for a pull
   * transport, where a failure is a read that threw and the supervisor measures
   * it as silence between two successes.
   *
   * A push transport fails differently, and the difference is not cosmetic. Its
   * connection can drop and recover BETWEEN two successful reads, so both reads
   * return on time, `coverage.observed()` finds no silence to measure, and the
   * window is recorded as watched. Nothing above the transport can detect this
   * afterwards — the only evidence is two instants that exist inside the
   * transport and nowhere else. So the transport reports them, and main.ts
   * records them exactly as it records the gaps coverage.ts computes.
   *
   * This is deliberately not "a stream field". It is the general statement "we
   * were connected for this read and still cannot answer for part of it", and a
   * poll whose source told it a sub-range was unavailable would use it too. What
   * it is NOT is a place to make a judgement: the tolerance that decides whether
   * a silence is jitter lives in exactly one place, and a transport that filtered
   * its own outages before reporting them would be a second one.
   *
   * Empty, never omitted. An optional field is one a new transport forgets, and
   * forgetting it is silent.
   */
  readonly blind: readonly Gap[];
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
  recordMints(mints: readonly MintEvent[]): Promise<void>;
  /**
   * A gap row. Separate from `recordMints` because a gap is not an absence of
   * mints — it is a statement that the question cannot be answered for that
   * window, and the labeller reads it to mark outcomes censored.
   */
  recordGap(gap: Gap): Promise<void>;
}
