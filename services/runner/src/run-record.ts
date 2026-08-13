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

import type { Millis, StageName } from '@insidor/contracts';

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
 * `stage` is a StageName, not a plain string: `StageRunRepo.open` in contracts
 * takes StageName, and this service only ever supervises the seven. Another
 * writer that puts a non-stage name in the same table — chainwatch does, under
 * its own name — needs that widening to happen in the contract, not to be
 * asserted away at this seam.
 */
export interface StageRunRecorder {
  open(stage: StageName, host: string, startedAt: Millis): Promise<string>;
  close(runId: string, result: StageRunResult): Promise<void>;
}

/** Compression is a diagnostic, not an arithmetic exercise: divide-by-zero is null. */
export function compressionOf(itemsIn: number, itemsOut: number): number | null {
  return itemsOut > 0 ? itemsIn / itemsOut : null;
}
