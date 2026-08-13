/**
 * The composition root. Two imports, and that is the whole point of this
 * service: `@insidor/store` for the read-only connection, `@insidor/contracts`
 * for the millisecond type. No core, no adapters, no other service. If this file
 * ever grows a third internal import, the watchdog has stopped being
 * independent and the third liveness layer has quietly become the first one
 * again.
 *
 * The snapshot read lives here rather than behind a repository, and that is a
 * deliberate cost. The repository ports are shaped for the pipeline's questions
 * — one stage, one item, one story — and the watchdog asks a different kind of
 * question: which stages exist at all, which of them nobody configured a cadence
 * for, and how the funnel moved week over week. Answering those through the
 * per-subject repositories would mean the watchdog telling the store the list of
 * stages it expects, which is the exact coupling W1's unknown-stage alert exists
 * to catch. Five SELECTs, no writes, over a role that can read `internal` and
 * nothing else.
 */

import { asDb, createPool, DB_ROLE, type Db } from '@insidor/store';
import type { Millis } from '@insidor/contracts';

import type { WatchdogConfig } from './config.ts';
import type {
  CompressionPair,
  CoverageGapRow,
  FeedWatermark,
  OpenRun,
  RunOutcome,
  SnapshotSource,
  StageRunSummary,
  WatchSnapshot,
} from './snapshot.ts';

const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;

/** How far back a recorded gap is still worth paging about. */
const GAP_LOOKBACK_MS = 24 * 60 * 60 * 1_000;

/** Caps, so a pathological table cannot turn one poll into a large read. */
const MAX_OPEN_RUNS = 200;
const MAX_GAPS = 200;

/*
 * Row shapes are written as type aliases rather than interfaces on purpose: the
 * driver's row constraint is an index signature, and only an alias gets an
 * implicit one. An interface here would need a cast to be accepted, and a cast
 * is how a column rename becomes a runtime `undefined` instead of an error.
 */

type StageRow = {
  stage: string;
  last_success_at: Date | null;
  last_finished_at: Date | null;
  last_outcome: string | null;
};

type OpenRunRow = {
  run_id: string;
  stage: string;
  host: string;
  started_at: Date;
};

type GapRow = {
  chain: string;
  kind: string;
  window_from: Date;
  window_to: Date;
};

type WatermarkRow = {
  chain: string;
  last_success_at: Date | null;
};

type CompressionRow = {
  stage: string;
  this_week: string | number | null;
  last_week: string | number | null;
};

function toMillis(at: Date): Millis {
  return at.getTime();
}

function toMillisOrNull(at: Date | null): Millis | null {
  return at === null ? null : at.getTime();
}

/**
 * Narrowed by switch rather than asserted. The column has a CHECK constraint, but
 * a constraint added by a migration this process never read is not a guarantee
 * this process may assume — and the cast that would assume it is exactly the kind
 * that turns a schema change into a wrong alert rather than a loud one.
 */
function toOutcome(value: string | null): RunOutcome | null {
  switch (value) {
    case 'ok':
    case 'empty':
    case 'error':
      return value;
    default:
      return null;
  }
}

/** `avg()` can arrive as a driver string. Parsing it is cheaper than being surprised. */
function toRatio(value: string | number | null): number | null {
  if (value === null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Last SUCCESS per stage, not last run. A stage erroring every 60 seconds has a
 * very recent last run and has been dead for an hour, and the index this leans on
 * (`stage_runs_recent_idx`) is partial on exactly that predicate.
 */
async function readStages(db: Db): Promise<readonly StageRunSummary[]> {
  const rows = await db.query<StageRow>(
    `select stage,
            max(finished_at) filter (where outcome in ('ok', 'empty')) as last_success_at,
            max(finished_at)                                           as last_finished_at,
            (array_agg(outcome order by finished_at desc)
               filter (where finished_at is not null))[1]              as last_outcome
       from internal.stage_runs
      group by stage`,
  );
  return rows.map((row) => ({
    stage: row.stage,
    lastSuccessAt: toMillisOrNull(row.last_success_at),
    lastFinishedAt: toMillisOrNull(row.last_finished_at),
    lastOutcome: toOutcome(row.last_outcome),
  }));
}

/** `finished_at IS NULL` is the only evidence a process was killed. Nothing backfills it. */
async function readOpenRuns(db: Db): Promise<readonly OpenRun[]> {
  const rows = await db.query<OpenRunRow>(
    `select id::text as run_id, stage, host, started_at
       from internal.stage_runs
      where finished_at is null
      order by started_at asc
      limit $1`,
    [MAX_OPEN_RUNS],
  );
  return rows.map((row) => ({
    runId: row.run_id,
    stage: row.stage,
    host: row.host,
    startedAt: toMillis(row.started_at),
  }));
}

/**
 * A recorded gap is not an error and nothing retries it: it is a statement that
 * lead time is unmeasurable for that window. The chain is the feed identity here,
 * because the mint coverage log is per chain.
 */
async function readGaps(db: Db, now: Millis): Promise<readonly CoverageGapRow[]> {
  const rows = await db.query<GapRow>(
    `select chain,
            coalesce(gap_reason, 'unspecified') as kind,
            window_from,
            window_to
       from internal.mint_coverage
      where gap and window_to >= $1
      order by window_from desc
      limit $2`,
    [new Date(now - GAP_LOOKBACK_MS), MAX_GAPS],
  );
  return rows.map((row) => ({
    feedId: row.chain,
    kind: row.kind,
    fromMs: toMillis(row.window_from),
    toMs: toMillis(row.window_to),
  }));
}

/**
 * The live edge of each feed. The filter is on the aggregate rather than the rows,
 * so a feed whose only rows are gaps still appears — with a null watermark, which
 * is the "never read successfully" alert. A WHERE clause would have dropped it,
 * and a feed that has never worked would be silently unmonitored.
 */
async function readFeeds(db: Db): Promise<readonly FeedWatermark[]> {
  const rows = await db.query<WatermarkRow>(
    `select chain,
            max(window_to) filter (where not gap) as last_success_at
       from internal.mint_coverage
      group by chain`,
  );
  return rows.map((row) => ({
    feedId: row.chain,
    lastSuccessAt: toMillisOrNull(row.last_success_at),
  }));
}

/** items_in / items_out, averaged over each of the last two weeks. */
async function readCompression(db: Db, now: Millis): Promise<readonly CompressionPair[]> {
  const twoWeeksAgo = new Date(now - 2 * WEEK_MS);
  const oneWeekAgo = new Date(now - WEEK_MS);
  const rows = await db.query<CompressionRow>(
    `select stage,
            avg(compression) filter (where finished_at >= $2) as this_week,
            avg(compression) filter (where finished_at >= $1 and finished_at < $2) as last_week
       from internal.stage_runs
      where finished_at >= $1 and compression is not null
      group by stage`,
    [twoWeeksAgo, oneWeekAgo],
  );
  return rows.map((row) => ({
    stage: row.stage,
    thisWeek: toRatio(row.this_week),
    lastWeek: toRatio(row.last_week),
  }));
}

/**
 * One snapshot, five reads, issued together so the five answers describe as close
 * to the same instant as a pool allows. `takenAt` is the caller's clock rather than
 * the database's: every threshold in checks.ts is measured against it, and a
 * snapshot timestamped by the machine being watched would make a stopped clock
 * look like a healthy pipeline.
 */
export async function readWatchSnapshot(db: Db, now: Millis): Promise<WatchSnapshot> {
  const [stages, openRuns, recentGaps, feeds, compression] = await Promise.all([
    readStages(db),
    readOpenRuns(db),
    readGaps(db, now),
    readFeeds(db),
    readCompression(db, now),
  ]);

  return { takenAt: now, stages, openRuns, recentGaps, feeds, compression };
}

export interface Runtime {
  readonly db: Db;
  readonly snapshots: SnapshotSource;
  close(): Promise<void>;
}

export function buildRuntime(cfg: WatchdogConfig): Runtime {
  // No singleton lock here, on purpose. Two watchdogs raising the same alert is
  // noise; zero watchdogs is the failure this exists to prevent.
  //
  // `app` names the CLIENT tuning, not the database grants: a short pool, a short
  // statement timeout, and no session-mode requirement, because this process takes
  // no advisory lock and opens no transaction. What it may actually read comes from
  // the connection string the deploy supplies — a role with SELECT on the two
  // tables below and nothing else. An observer with write access is an observer
  // that can become a cause.
  const pool = createPool(DB_ROLE.app, {
    applicationName: 'insidor-watchdog',
    env: { DATABASE_URL_APP: cfg.databaseUrl },
  });
  const db = asDb(pool);

  return {
    db,
    snapshots: { read: (now) => readWatchSnapshot(db, now) },
    close: () => pool.end(),
  };
}
