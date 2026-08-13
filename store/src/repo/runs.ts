/**
 * Stage runs. The two-call shape that makes "died" distinguishable from "found
 * nothing".
 *
 * `open()` is called BEFORE the work and `close()` from a `finally`, never from
 * inside the try. That inversion is the entire fix: the build this replaces
 * recorded the run inside the try, so a stage that threw wrote nothing at all, and
 * a stage that succeeded over zero rows was indistinguishable from one that
 * succeeded over a thousand. Seven hours of dead ingest looked exactly like a quiet
 * afternoon.
 *
 * The three states that fall out, for free:
 *   finished_at IS NULL forever  the process was killed mid-run
 *   outcome = 'empty'            it ran, it worked, there was nothing to do
 *   outcome = 'error'            it ran and it failed
 */

import { STAGE_NAMES } from '@insidor/contracts';
import type { Millis, StageName } from '@insidor/contracts';
import type { StageRunOutcome, StageRunRepo } from '@insidor/contracts/ports/store.ts';

import type { Db } from '../client.ts';
import { toMillis, toMillisRequired, toTimestamp } from '../rows.ts';
import type { TimestampColumn } from '../rows.ts';

export interface StageRunClose {
  /** ★ 'empty' is not 'error'. A stage that found nothing and a stage that died
   *  must be different rows, or a dead pipeline looks like a quiet night. */
  readonly outcome: StageRunOutcome;
  readonly err: string | null;
  readonly itemsIn: number;
  readonly itemsOut: number;
  readonly durationMs: number;
}

export class PgStageRunRepo implements StageRunRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Open a run row. Call this first; if the process dies now, the NULL is the
   * evidence.
   *
   * The clock is an argument rather than `now()`, for the same reason a stage is
   * handed its clock: a run replayed from a recorded instant has to be able to say
   * when it actually happened.
   */
  async open(stage: StageName, host: string, at: Millis): Promise<string> {
    const rows = await this.#db.query<{ id: string }>(
      `insert into internal.stage_runs (stage, host, started_at)
       values ($1, $2, $3) returning id::text`,
      [stage, host, toTimestamp(at)],
    );
    const row = rows[0];
    if (!row) throw new Error('stage run insert returned no row');
    return row.id;
  }

  /**
   * Close a run row. `compression` — items in over items out — is computed here so
   * that the primary funnel diagnostic exists on every run without anybody
   * remembering to record it. It is also what lets the watchdog notice a stage that
   * changed behaviour by 3× without ever changing its exit code.
   */
  async close(runId: string, result: StageRunClose): Promise<void> {
    await this.#db.query(
      `update internal.stage_runs
          set finished_at = now(),
              outcome = $2, err = $3,
              items_in = $4, items_out = $5,
              compression = $6, duration_ms = $7
        where id = $1 and finished_at is null`,
      [
        runId,
        result.outcome,
        result.err,
        result.itemsIn,
        result.itemsOut,
        result.itemsOut > 0 ? result.itemsIn / result.itemsOut : null,
        result.durationMs,
      ],
    );
  }

  /**
   * The watchdog's question: when did this stage last SUCCEED. Not "last run" — a
   * stage erroring every 60 seconds has a very recent last run and has been dead
   * for an hour.
   */
  async lastSuccessAt(stage: StageName): Promise<Millis | null> {
    const rows = await this.#db.query<{ finished_at: TimestampColumn }>(
      `select max(finished_at) as finished_at
         from internal.stage_runs
        where stage = $1 and outcome in ('ok', 'empty')`,
      [stage],
    );
    const row = rows[0];
    return row ? toMillis(row.finished_at) : null;
  }

  /**
   * Runs still open past a deadline. A stage that hangs never throws and never
   * alerts on its own.
   *
   * `now` is passed in rather than read from the database so the watchdog's window
   * is the watchdog's decision, and so the query means the same thing when it is
   * replayed. The id rides along beyond what the port asks for: it is what turns
   * "something is stuck" into a row somebody can go and look at.
   */
  async openLongerThan(
    ms: number,
    now: Millis,
  ): Promise<readonly { readonly id: string; readonly stage: StageName; readonly startedAt: Millis }[]> {
    const rows = await this.#db.query<{ id: string; stage: string; started_at: TimestampColumn }>(
      `select id::text, stage, started_at
         from internal.stage_runs
        where finished_at is null
          and started_at < $1::timestamptz - make_interval(secs => $2::double precision)
        order by started_at asc`,
      [toTimestamp(now), ms / 1000],
    );
    return rows.map((row) => ({
      id: row.id,
      stage: toStageName(row.stage),
      startedAt: toMillisRequired(row.started_at, 'started_at'),
    }));
  }
}

/**
 * `stage` is a bare text column — the migration deliberately does not constrain it,
 * so that a stage added in code is not a schema change. Which means a value read
 * back has to be checked against the vocabulary rather than assumed to be in it: an
 * unknown stage name is a row written by something that is not this code, and it
 * should say so loudly rather than flow on as a StageName that is not one.
 */
function toStageName(value: string): StageName {
  const known = STAGE_NAMES.find((stage) => stage === value);
  if (known === undefined) {
    throw new TypeError(`stage_runs.stage holds '${value}', which is not a stage name`);
  }
  return known;
}
