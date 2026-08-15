/**
 * The durable mint cursor.
 *
 * Two fields, and both are load-bearing for a different reason.
 *
 * `position` is opaque to this process — a signature, a slot, a page token,
 * whatever the source uses. Interpreting it here would put a chain's or a
 * launchpad's semantics into a service, and the service is the one layer that
 * must stay ignorant of both.
 *
 * `readAt` is OURS: the instant we last completed a successful read. It is what
 * survives a restart and lets coverage.ts turn a deploy into a recorded gap
 * instead of an invisible one. A cursor that stored only `position` would let
 * the process resume in the right place while quietly losing the fact that it
 * was away for four minutes.
 */

import type { Millis } from '@insidor/contracts';

import type { CoverageWindow } from './coverage.ts';

export interface MintCursor {
  readonly feedId: string;
  /** null on a cold start: we have never read this feed. */
  readonly position: string | null;
  /** null on a cold start. Never defaulted to `now` — that would erase the gap. */
  readonly readAt: Millis | null;
}

/** The store side. Implemented in wiring.ts against @insidor/store. */
export interface CursorStore {
  load(feedId: string): Promise<MintCursor>;
  /**
   * Written only AFTER the mints from that read are persisted. See main.ts.
   *
   * `observed` is not decoration. There is no cursor table in the schema: the
   * resume position is a column on the coverage row (`mint_coverage.cursor_ref`),
   * because a position with no record of the window it closed is a claim we
   * cannot check. So saving the cursor and declaring the windows it completed are
   * one write.
   *
   * ★ WHY IT IS A LIST AND NOT A SINGLE `coveredFromMs`, which is what it was.
   * A cycle's window is not always one interval. A push transport can report that
   * its connection was down for part of the window it just answered for, and the
   * cycle then covers the pieces either side of that hole and NOT the hole. Given
   * one instant to start from, the only row this could write was the whole span —
   * including the dark part, flagged `gap = false`, sitting on top of the gap row
   * the same cycle had just written. The list is what makes the two kinds of row
   * partition the timeline instead of contradicting each other; `observedSegments`
   * in coverage.ts computes it.
   *
   * EMPTY IS A LEGAL ANSWER and means the holes swallowed the entire window —
   * there is nothing this cycle may claim. The implementation must still record
   * the resume position, and must not invent a window to hang it on.
   */
  save(cursor: MintCursor, observed: readonly CoverageWindow[]): Promise<void>;
}

export function coldCursor(feedId: string): MintCursor {
  return { feedId, position: null, readAt: null };
}
