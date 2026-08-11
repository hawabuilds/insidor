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
  /** Written only AFTER the mints from that read are persisted. See main.ts. */
  save(cursor: MintCursor): Promise<void>;
}

export function coldCursor(feedId: string): MintCursor {
  return { feedId, position: null, readAt: null };
}
