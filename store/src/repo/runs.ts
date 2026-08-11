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

import type { StageName } from '@insidor/contracts';
import type { StageRunRepo } from '@insidor/contracts/ports/store.ts';

import type { Db } from '../client.ts';

export interface StageRunClose {
  readonly outcome: 'ok' | 'empty' | 'error';
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

  /** Open a run row. Call this first; if the process dies now, the NULL is the evidence. */
  async open(stage: StageName, host: string): Promise<string> {
    const rows = await this.#db.query<{ id: string }>(
      `insert into internal.stage_runs (stage, host) values ($1, $2) returning id::text`,
      [stage, host],
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
  async lastSuccessAt(stage: StageName): Promise<Date | null> {
    const rows = await this.#db.query<{ finished_at: Date | null }>(
      `select max(finished_at) as finished_at
         from internal.stage_runs
        where stage = $1 and outcome in ('ok', 'empty')`,
      [stage],
    );
    return rows[0]?.finished_at ?? null;
  }

  /** Runs still open past a deadline. A stage that hangs never throws and never alerts on its own. */
  async openLongerThan(seconds: number): Promise<{ id: string; stage: string; startedAt: Date }[]> {
    const rows = await this.#db.query<{ id: string; stage: string; started_at: Date }>(
      `select id::text, stage, started_at
         from internal.stage_runs
        where finished_at is null and started_at < now() - make_interval(secs => $1)
        order by started_at asc`,
      [seconds],
    );
    return rows.map((row) => ({ id: row.id, stage: row.stage, startedAt: row.started_at }));
  }
}
