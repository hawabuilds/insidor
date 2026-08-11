/**
 * GAP DETECTION — the reason this process is its own deployable.
 *
 * The product's central claim is lead time: we named the coin this many minutes
 * after it was minted. That claim is only honest for windows we were actually
 * watching. A mint we missed does not show up as a wrong answer; it shows up as
 * nothing at all, and "nothing at all" is indistinguishable from "no mint
 * happened" unless we write down when we were and were not looking.
 *
 * So coverage is recorded as intervals, and every interruption becomes a row:
 *
 *   not_watching   wall-clock time with no successful read. A deploy restart,
 *                  a vendor outage, a crash. The window is UNMEASURABLE, and
 *                  the labeller must mark it censored rather than negative.
 *   page_overflow  we were watching, but the source returned a full page, so
 *                  there may be mints between the cursor and the oldest row we
 *                  received. Being connected is not the same as being complete.
 *   cursor_reset   the durable cursor could not be resumed, so everything
 *                  before the restart is unproven regardless of uptime.
 *
 * The distinction that matters: a gap is not an error. Nothing here retries,
 * alerts or recovers. It records, so that a downstream lead-time number is
 * computed over windows we can defend, and the watchdog can page on a gap that
 * stays open. Silence would make every gap read as a clean run.
 *
 * The module is deliberately state-in-a-closure and side-effect-free: it
 * RETURNS the gaps it detects and never writes them. Persisting is the caller's
 * job, which is what makes the rule testable without a database.
 */

import type { Millis } from '@insidor/contracts';

export type GapKind = 'not_watching' | 'page_overflow' | 'cursor_reset';

export interface Gap {
  readonly kind: GapKind;
  /** Inclusive start of the window we cannot vouch for. */
  readonly fromMs: Millis;
  /** Exclusive end. */
  readonly toMs: Millis;
  readonly detail: string;
}

export interface Coverage {
  /**
   * Call after EVERY successful read, with the instant that read completed.
   * Returns a gap when more than `toleranceMs` passed since the previous
   * successful read — including across a process restart, if the watermark was
   * loaded from the durable cursor.
   */
  observed(at: Millis): Gap | null;

  /**
   * Call when the source returned exactly as many rows as were asked for. The
   * page was full, so completeness is unproven between the watermark we asked
   * from and the oldest row we got back.
   */
  pageOverflow(fromMs: Millis, toMs: Millis, limit: number): Gap;

  /** Call when the cursor could not be resumed. */
  cursorReset(lastKnownAt: Millis | null, at: Millis): Gap;

  /** The instant of the last successful read, or null if we have never had one. */
  watermark(): Millis | null;
}

export interface CoverageOptions {
  /**
   * How long a silence is allowed to be before it counts as a gap. Should be a
   * small multiple of the read interval: one missed read is jitter, three in a
   * row is a hole.
   */
  readonly toleranceMs: number;
  /**
   * The instant of the last successful read from the PREVIOUS run of this
   * process, loaded from the durable cursor. Passing it is what turns a deploy
   * restart into a recorded gap instead of an invisible one.
   */
  readonly resumeFrom: Millis | null;
}

export function createCoverage(opts: CoverageOptions): Coverage {
  let last: Millis | null = opts.resumeFrom;

  return {
    observed(at) {
      const previous = last;
      last = at;

      // First successful read ever. There is no earlier window to compare
      // against, so there is no gap — an unbounded "we were not watching since
      // the beginning of time" row would be true and useless.
      if (previous === null) return null;

      const silenceMs = at - previous;
      if (silenceMs <= opts.toleranceMs) return null;

      return {
        kind: 'not_watching',
        fromMs: previous,
        toMs: at,
        detail: `no successful read for ${silenceMs}ms (tolerance ${opts.toleranceMs}ms)`,
      };
    },

    pageOverflow(fromMs, toMs, limit) {
      return {
        kind: 'page_overflow',
        fromMs,
        toMs,
        detail: `source returned a full page of ${limit}; rows in this window may be missing`,
      };
    },

    cursorReset(lastKnownAt, at) {
      last = at;
      return {
        kind: 'cursor_reset',
        // A reset with no known position cannot bound its own start. Marking
        // the window zero-width and saying so is honest; inventing a start is
        // not.
        fromMs: lastKnownAt ?? at,
        toMs: at,
        detail:
          lastKnownAt === null
            ? 'cursor could not be resumed and no previous position was known'
            : 'cursor could not be resumed; everything after the last known position is unproven',
      };
    },

    watermark() {
      return last;
    },
  };
}
