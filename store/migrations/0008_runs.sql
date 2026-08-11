-- 0008_runs.sql
--
-- Stage runs, so that a stage which DIED is distinguishable from one that ran and
-- found nothing.
--
-- The build this replaces could not tell them apart. The cause was one line: the
-- "record last run" call sat INSIDE the try block, so a stage that threw wrote
-- nothing at all, and a stage that succeeded over zero rows wrote exactly what a
-- stage that succeeded over a thousand rows wrote. There was no state in the
-- database that separated the two, which is how seven hours of dead ingest went
-- unnoticed.
--
-- The fix is structural rather than diligent. The row is opened BEFORE the work and
-- closed in a `finally`, so:
--   finished_at IS NULL forever      == the process was killed mid-run
--   outcome = 'empty'                == it ran, it worked, there was nothing to do
--   outcome = 'error'                == it ran and it failed
-- Three states that used to be one silence.

create table internal.stage_runs (
  id          bigserial primary key,
  stage       text not null,
  started_at  timestamptz not null default now(),

  -- ★ NULL forever means the process was killed. Nothing backfills this column;
  -- a sweeper that "tidied up" open runs would delete the only evidence of a crash.
  finished_at timestamptz,
  outcome     text check (outcome in ('ok', 'empty', 'error')),
  err         text,

  items_in    integer,
  items_out   integer,
  -- items_in / items_out. The funnel diagnostic, recorded on every run without
  -- anyone having to remember to compute it — and a compression ratio that moves
  -- 3× week-over-week is the watchdog's earliest signal that a stage changed
  -- behaviour without changing its exit code.
  compression double precision,
  duration_ms integer,
  host        text not null,

  constraint finished_has_an_outcome check ((finished_at is null) = (outcome is null)),
  constraint error_says_why check (outcome <> 'error' or err is not null)
);

-- The watchdog's first query: anything still open. Partial, so it stays tiny
-- regardless of how large the table grows.
create index stage_runs_open_idx on internal.stage_runs (started_at)
  where finished_at is null;

-- The watchdog's second query: when did this stage last SUCCEED. Not "last run" —
-- a stage erroring every 60 seconds has a very recent last run.
create index stage_runs_recent_idx on internal.stage_runs (stage, finished_at desc)
  where outcome in ('ok', 'empty');

comment on column internal.stage_runs.finished_at is
  'NULL forever means the process was killed mid-run. Never backfill this column.';

/* The watchdog runs on a different provider from the pipeline, over a read-only
   connection, and needs exactly these two tables. insidor_service already has
   SELECT on internal by default privilege, which covers it; the comment is here so
   the next person to tighten grants knows what would break. */
