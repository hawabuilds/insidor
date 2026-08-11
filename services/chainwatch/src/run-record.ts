/**
 * The run record, written to the same `internal.stage_runs` table the runner
 * uses, under the stage name 'chainwatch'.
 *
 * WHY THE SAME TABLE: the watchdog's rule is "any stage whose last successful
 * run is older than 3× its cadence". Giving the mint watcher its own table
 * would mean writing that rule twice, and a monitoring rule that exists in two
 * places is a monitoring rule that will be updated in one.
 *
 * The coverage log answers a different question and does not replace this.
 * A run row says whether the process is alive; a coverage row says whether the
 * answer it produced can be trusted. A dead process writes neither, which is
 * exactly why both are opened before the work and closed in a `finally`.
 */

import type { Millis } from '@insidor/contracts';

export type RunOutcome = 'ok' | 'empty' | 'error';

export interface StageRunResult {
  readonly outcome: RunOutcome;
  readonly err: string | null;
  readonly itemsIn: number;
  readonly itemsOut: number;
  readonly compression: number | null;
  readonly durationMs: number;
}

export interface StageRunRecorder {
  open(stage: string, host: string, startedAt: Millis): Promise<string>;
  close(runId: string, result: StageRunResult): Promise<void>;
}
