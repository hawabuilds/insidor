/**
 * WHETHER A SOURCE IS LIVE — the recorded operational fact, and the three names
 * it is allowed to resolve to.
 *
 * ★ WHY THIS IS A VOCABULARY AND NOT A BOOLEAN. The obvious shape is `live:
 * boolean`, and `launch_view.source` already ships one for a single feed. It is
 * not enough here, and the gap is the whole reason this file exists: `false`
 * collapses two states that demand opposite responses.
 *
 *   dormant  nobody supplied a credential. Nobody turned it on. THIS IS NOT A
 *            FAULT and must never be dressed as one — the answer is a person
 *            deciding to pay for something, on their own schedule.
 *   failing  a credential IS present and the calls are not working. The answer
 *            is somebody looking at it today. "You are paying for this and it is
 *            broken" is a different sentence from "you have not turned this on",
 *            and a surface that renders both as a dark pip has told the reader
 *            nothing.
 *
 * That distinction already exists at the vendor edge — a not-configured error is
 * its own class there precisely so a permanently unconfigured source does not
 * spend weeks looking like an intermittently flaky one. This file is that same
 * argument carried far enough to reach a screen.
 *
 * ★ AND WHY THE STATE IS DERIVED RATHER THAN STORED. `SourceHealth` below is a
 * record of what HAPPENED — the last success, the last failure, how many in a
 * row. The three-way call is a judgement made against thresholds in Policy, and a
 * judgement stored in a column is a judgement nobody can re-derive after the
 * thresholds move. So the row holds facts and `core` holds the rule, the same
 * split as everywhere else in this system.
 *
 * ★ AND WHY THE RECORD IS INTERNAL. `configurationDetail` and `lastFailureReason`
 * name environment variables and quote vendor errors. Both are operational text
 * about our own machinery, which is exactly the class of thing the app is never
 * shown; the row lives in `internal` and a projector decides what, if anything,
 * of it may be said out loud.
 */

import type { SourceId } from './ids.ts';
import type { Millis } from './vocabulary.ts';

/* ── the three states ─────────────────────────────────────────────────── */

/**
 * Ordered from the state that needs no action to the one that needs it today.
 * The order is not load-bearing for correctness; it is how the list reads.
 */
export const SOURCE_STATES = ['live', 'dormant', 'failing'] as const;

export type SourceState = (typeof SOURCE_STATES)[number];

/* ── what configuration said ──────────────────────────────────────────── */

/**
 * What the environment says about a source, as read at boot by the one process
 * that holds the environment.
 *
 * ★ `misconfigured` IS A SEPARATE MEMBER AND IT IS THE ONE THAT IS EASY TO LOSE.
 * A source whose credentials are entirely absent has not been turned on. A source
 * with SOME of its credentials present has been turned on by somebody who then
 * got it wrong — a half-filled block, a variable renamed on one side of a deploy,
 * a secret that did not make it into the environment. Folding that into `dormant`
 * would report an operator's mistake as an operator's choice, and it is the single
 * most likely way a source that somebody believes is running is silently not.
 * It resolves to `failing`, not to `dormant`, and the detail says which variables.
 */
export const SOURCE_CONFIGURATIONS = ['dormant', 'configured', 'misconfigured'] as const;

export type SourceConfiguration = (typeof SOURCE_CONFIGURATIONS)[number];

/* ── the recorded fact ────────────────────────────────────────────────── */

/**
 * One source's operational record. Written by whichever process actually calls
 * the source; read by whatever needs to say how the pipeline is doing.
 *
 * It is CURRENT STATE and not a series, deliberately. The series already exists —
 * `internal.stage_runs` holds one row per run, forever — and a second append-only
 * table keyed by source would be a reading series nobody differences. What is
 * missing is the current position, which is what this is.
 */
export interface SourceHealth {
  readonly source: SourceId;
  readonly configuration: SourceConfiguration;
  /**
   * Which variables are missing, or what is wrong with the ones that are set.
   * Operator-facing text: it names environment variables and therefore never
   * reaches a browser without going through a projector that rewrites it.
   */
  readonly configurationDetail: string | null;
  /** Since when the source has been in this configuration. Not when we last looked. */
  readonly configuredAt: Millis;
  /**
   * The last call that WORKED — not the last call. A source erroring every minute
   * has a very recent last call and has been dead for an hour; that is the same
   * mistake `stage_runs` keys off last-success to avoid.
   */
  readonly lastSuccessAt: Millis | null;
  readonly lastFailureAt: Millis | null;
  /** The vendor's own message, kept whole. Never parsed, never matched against. */
  readonly lastFailureReason: string | null;
  /**
   * Failures since the last success. Reset to zero BY a success, so a non-zero
   * value always describes failures that came after the last thing that worked.
   * That property is what lets one bar mean the same thing on every source.
   */
  readonly consecutiveFailures: number;
}
