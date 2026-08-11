/**
 * What the watchdog is allowed to see.
 *
 * One read, over a Postgres role that can SELECT two tables and nothing else.
 * The narrowness is the point: an observer with write access is an observer
 * that can become a cause, and an observer that can read everything is one that
 * will eventually be given a job that makes it part of the pipeline.
 *
 * Note what is NOT here — no Decision, no Policy, no FeatureVector, no item
 * text. The watchdog answers "is the machine running", never "is the machine
 * right". The second question belongs to eval/, which has a replay log and no
 * pager.
 */

import type { Millis } from '@insidor/contracts';

export type RunOutcome = 'ok' | 'empty' | 'error';

export interface StageRunSummary {
  readonly stage: string;
  /** Last run that finished without erroring. NULL means it has never succeeded. */
  readonly lastSuccessAt: Millis | null;
  readonly lastFinishedAt: Millis | null;
  readonly lastOutcome: RunOutcome | null;
}

/** A row with `finished_at IS NULL`. Either in flight, or the process died. */
export interface OpenRun {
  readonly runId: string;
  readonly stage: string;
  readonly host: string;
  readonly startedAt: Millis;
}

/** A recorded window during which mint coverage cannot be vouched for. */
export interface CoverageGapRow {
  readonly feedId: string;
  readonly kind: string;
  readonly fromMs: Millis;
  readonly toMs: Millis;
}

/** The live edge of a feed: when it last read successfully. */
export interface FeedWatermark {
  readonly feedId: string;
  readonly lastSuccessAt: Millis | null;
}

/**
 * The funnel diagnostic. Compression is items_in / items_out, averaged over a
 * week; a 3× move week over week means the shape of the pipeline changed
 * without anyone deciding to change it.
 */
export interface CompressionPair {
  readonly stage: string;
  readonly thisWeek: number | null;
  readonly lastWeek: number | null;
}

export interface WatchSnapshot {
  readonly takenAt: Millis;
  readonly stages: readonly StageRunSummary[];
  readonly openRuns: readonly OpenRun[];
  readonly recentGaps: readonly CoverageGapRow[];
  readonly feeds: readonly FeedWatermark[];
  readonly compression: readonly CompressionPair[];
}

/** Implemented in wiring.ts against @insidor/store. */
export interface SnapshotSource {
  read(now: Millis): Promise<WatchSnapshot>;
}
