/**
 * The run record: the row that makes "died" distinguishable from "found nothing".
 *
 * The build this replaces called `recordLastRun()` INSIDE the try block, so a
 * stage that threw wrote nothing at all, and a stage that succeeded with zero
 * rows wrote exactly what a stage that succeeded with a thousand rows wrote.
 * There was no state in the database that told the two apart. That is why seven
 * hours of a dead pipeline went unnoticed.
 *
 * Three properties fix it, and all three are shapes, not vigilance:
 *   - the row is opened BEFORE the work, so a killed process leaves
 *     `finished_at` NULL forever;
 *   - the row is closed in a `finally`, so an exception still writes;
 *   - 'empty' is a distinct outcome from 'error', so "ran, found nothing" is
 *     a queryable state rather than an inference.
 */

import type { Millis } from '@insidor/contracts';

import type { SupervisedName } from './config.ts';

export type RunOutcome = 'ok' | 'empty' | 'error';

export interface StageRunResult {
  readonly outcome: RunOutcome;
  /** Non-null only on 'error'. The message, never the stack: stacks are noise here. */
  readonly err: string | null;
  readonly itemsIn: number;
  readonly itemsOut: number;
  /** itemsIn / itemsOut. Null when nothing came out — a ratio, not a zero. */
  readonly compression: number | null;
  readonly durationMs: number;
}

/**
 * ★ `stage` IS A `SupervisedName` AND NOT A `StageName`, AND THAT WIDENING IS A
 * DECISION RATHER THAN A CONVENIENCE.
 *
 * It used to be StageName, on the argument that "this service only ever supervises
 * the seven". That stopped being true when discovery arrived: discovery is
 * supervised, writes run rows, and is NOT a decision stage — `Decision.stage` is
 * typed from STAGE_NAMES and `internal.decisions` enumerates those seven in a CHECK,
 * so putting `discover` in that union would add a member no decision can ever carry.
 *
 * `internal.stage_runs.stage` is free text on purpose and chainwatch already writes
 * to it under its own name; the ★ in services/chainwatch/src/wiring.ts argues the
 * same widening at length and asks which side is wrong. This is the answer for this
 * service: the RUN vocabulary is wider than the DECISION vocabulary, the port that
 * records runs takes the wider one, and `StageRunRepo` in contracts is left alone —
 * widening it there would let a caller pass a non-stage into a repository that also
 * serves the decision log.
 */
export interface StageRunRecorder {
  open(stage: SupervisedName, host: string, startedAt: Millis): Promise<string>;
  close(runId: string, result: StageRunResult): Promise<void>;
}

/** Compression is a diagnostic, not an arithmetic exercise: divide-by-zero is null. */
export function compressionOf(itemsIn: number, itemsOut: number): number | null {
  return itemsOut > 0 ? itemsIn / itemsOut : null;
}
