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
 *   stream_disconnect  a PUSH transport's connection dropped and came back
 *                  while this process stayed up. Split out from not_watching
 *                  because it is the one hole nothing above the transport can
 *                  see: both reads either side of it succeeded, so there is no
 *                  silence to measure and no restart to blame, and the only
 *                  evidence is two instants the socket itself remembers. It is
 *                  also answered differently — a redeploy is our schedule, a
 *                  flapping socket is a transport that needs looking at — and a
 *                  reason string nobody can filter on is a reason nobody reads.
 *   page_overflow  we were watching, but the source returned a full page, so
 *                  there may be mints between the cursor and the oldest row we
 *                  received. Being connected is not the same as being complete.
 *   read_not_stored  we were watching, the read answered, and the cycle then
 *                  failed before those mints were durable. Not the same as
 *                  either of the above and it took a live failure injection to
 *                  notice: see `readNotStored` below.
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

export type GapKind =
  | 'not_watching'
  | 'stream_disconnect'
  | 'page_overflow'
  | 'read_not_stored'
  | 'cursor_reset';

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

  /**
   * ★ Call when a read SUCCEEDED and the cycle then failed before those mints
   * were durable — a sink that threw, a coverage write that threw, a cursor
   * save that threw.
   *
   * WHY THIS IS NOT COVERED BY `observed()`, which is what the loop relied on
   * until a live failure injection proved otherwise. Not extending the
   * watermark on a failed cycle is the right thing to do and it is not by
   * itself a record: `observed()` only reports a hole once the silence exceeds
   * `toleranceMs`, and the tolerance is a statement about read CADENCE jitter.
   * A cycle that fails and recovers three seconds later, under any sane
   * tolerance, produces NO gap at all — and the next successful cycle then
   * writes one clean coverage row spanning the failure, because its window
   * starts at the un-extended watermark.
   *
   * For a PULL transport that is harmless: the cursor did not move, so the same
   * mints are re-read and the wide clean row is true. For a PUSH transport it is
   * the exact failure this service exists to prevent — the drain already emptied
   * the buffer, so those mints are gone, and the log says the window was
   * watched. Eight mints and two clean rows, in the run that found this.
   *
   * So the window is declared at the moment the cycle fails, by the only code
   * that still knows what it was. The watermark is deliberately NOT moved: this
   * is a hole, not a read.
   */
  readNotStored(fromMs: Millis, toMs: Millis, why: string): Gap;

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

    readNotStored(fromMs, toMs, why) {
      // `last` is untouched on purpose. The read happened; the mints did not
      // land. Moving the watermark here would let the next cycle's row start
      // after a window nothing stands behind, which is the whole bug.
      return {
        kind: 'read_not_stored',
        fromMs,
        toMs,
        detail: `read completed but the cycle failed before its mints were durable: ${why}`,
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

/* ── what a cycle is allowed to claim it watched ─────────────────────────── */

/** A bare interval. Half-open: `fromMs` inclusive, `toMs` exclusive. */
export interface CoverageWindow {
  readonly fromMs: Millis;
  readonly toMs: Millis;
}

/**
 * ★ THE WINDOW A CYCLE MAY CLAIM, WHICH IS ITS OWN WINDOW MINUS EVERY HOLE IT
 * JUST DECLARED.
 *
 * WHY THIS FUNCTION EXISTS, and it took severing a live socket to see it. A
 * cycle wrote two rows: one gap row over the 612ms its socket was down, and one
 * observed row over the whole read-to-read interval — which CONTAINED those
 * 612ms and carried `gap = false`. Both rows were written, both were logged, and
 * together they said two different things about the same 612ms.
 *
 * That is not a rounding error, because a coverage row is not a note, it is a
 * claim. `internal.mint_coverage` is read three ways and only one of them
 * survives an overlap: `hasCoverageGap` takes `bool_or(gap)` over everything
 * that intersects the window it is asked about, so the labeller still censors
 * correctly and that is why nothing was visibly broken. The watchdog's live edge
 * is `max(window_to) filter (where not gap)`, which happily advances across a
 * hole. And any arithmetic over "how long were we watching" — the denominator
 * under every lead-time number this product publishes — sums the observed rows
 * and counts the dark time twice: once as watched, once as missed.
 *
 * So the rule is that the two kinds of row PARTITION the timeline rather than
 * layer over it. The gaps are recorded as they were reported, one row per cause,
 * because the cause is the thing a human wants; what is subtracted here is only
 * what the cycle is permitted to say it SAW. What comes back is the leftovers,
 * in order, and each becomes one observed row. When the holes swallow the whole
 * window the answer is the empty array, which is the correct answer and the
 * caller has to handle it rather than fall back to claiming the window.
 *
 * Holes are clipped to `[fromMs, toMs]` and may arrive in any order, overlapping
 * or nested — two mechanisms describing one outage is the normal case, not an
 * error, and the union of them is what is taken out.
 *
 * Pure, like everything else in this file, so the arithmetic that decides
 * whether a lead-time claim is honest is testable without a socket or a table.
 */
export function observedSegments(
  fromMs: Millis,
  toMs: Millis,
  holes: readonly CoverageWindow[],
): readonly CoverageWindow[] {
  // A window with no width claims nothing, so there is nothing to carve.
  if (!(toMs > fromMs)) return [];

  const clipped = holes
    .map((hole) => ({
      fromMs: Math.max(hole.fromMs, fromMs),
      toMs: Math.min(hole.toMs, toMs),
    }))
    // A hole entirely outside this window clips to nothing. Dropping it here
    // rather than refusing it is deliberate: a gap that belongs to an earlier
    // cycle is still a true row, it is simply not this cycle's to subtract.
    .filter((hole) => hole.toMs > hole.fromMs)
    .sort((a, b) => a.fromMs - b.fromMs);

  const segments: CoverageWindow[] = [];
  let at = fromMs;
  for (const hole of clipped) {
    if (hole.fromMs > at) segments.push({ fromMs: at, toMs: hole.fromMs });
    // `max`, not assignment: the next hole may be nested inside this one, and
    // moving the mark backwards would re-open a window we have already given up.
    at = Math.max(at, hole.toMs);
  }
  if (toMs > at) segments.push({ fromMs: at, toMs });
  return segments;
}
