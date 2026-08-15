/**
 * THE PUSH PORT: what this service needs from a transport that arrives instead
 * of answering.
 *
 * `MintFeed` is a PULL contract — `read(cursor, limit, signal)` returns a page —
 * and that is not an accident to be worked around. It is what lets one loop
 * supervise both kinds of transport: the cursor, the backoff, the run record and
 * the coverage arithmetic are written once, against a shape where "we asked and
 * this is what we got" is a single instant. A socket cannot be asked. So the
 * bridge is a connection that runs continuously and a buffer that a read drains,
 * and the port below is exactly the seam between those two.
 *
 * ★ WHY THE PORT IS DECLARED HERE AND NOT IMPORTED FROM THE ADAPTER. It names no
 * vendor, no chain and no venue, and it must not: this service is the layer that
 * stays ignorant of all three. TypeScript is structural, so the adapter's socket
 * client satisfies this without either side importing the other, and wiring.ts —
 * the one file here permitted to name another package — is where they meet. If
 * this file ever needs a word from a vendor's documentation to describe a field,
 * the field belongs in the adapter instead.
 *
 * WHAT THE PORT HAS TO CARRY, AND WHY EACH ONE IS SEPARATE.
 *
 * `limited` and `dropped` are two facts and not one number, because they are
 * opposite kinds of incomplete. A drain that hit its limit left events in the
 * buffer and we will have them next cycle. A drop destroyed them and we never
 * will. Collapsing the two would either hide a real hole or invent one.
 *
 * `outages` exists because a socket fails INSIDE a window. A poll either answers
 * or throws, so its failures are whole reads and `coverage.observed()` sees every
 * one of them by measuring the silence between successes. A socket that drops for
 * twelve seconds between two successful drains produces no silence at all — both
 * reads succeeded, on time — and a supervisor with only a poll's vocabulary
 * records a clean window over an interval nobody was listening to. The transport
 * is the only thing that knows those twelve seconds happened, so it has to be
 * able to say so.
 */

import type { Millis, MintEvent } from '@insidor/contracts';

/** A window during which the source was not delivering. A fact, not a decision. */
export interface StreamOutage {
  /** Inclusive start. */
  readonly fromMs: Millis;
  /** Exclusive end. Strictly after `fromMs`, or it is not a window. */
  readonly toMs: Millis;
  readonly detail: string;
}

export interface StreamDrain {
  readonly events: readonly MintEvent[];
  /** Handed over as many as asked for: more are waiting, none were lost. */
  readonly limited: boolean;
  /** Events destroyed because the buffer was full. Lost, not delayed. */
  readonly dropped: number;
  /** Outages that closed since the previous drain. Empty is the normal answer. */
  readonly outages: readonly StreamOutage[];
}

export interface MintStream {
  start(): void;
  stop(): void;
  /**
   * Delivering right now. A false answer here is a read that must not succeed.
   *
   * ★ AND IT MUST BE ASKED BEFORE `drain`, NOT AFTER. A transport is allowed to
   * DISCOVER that it is not delivering at the moment it is asked — a half-open
   * socket has no event to announce itself with, so the only way to notice is to
   * check how long it has been silent, and the only sensible moment to check is
   * when somebody wants events. A caller that drains first and asks afterwards
   * gets an empty, clean-looking page over a window the transport has by then
   * concluded was dark, and writes it as observed.
   */
  live(): boolean;
  /** The instant the current live period began, or null while down. */
  liveSince(): Millis | null;
  drain(limit: number): StreamDrain;
  /** Opaque to this service, as every cursor position is. */
  position(): string;
}
