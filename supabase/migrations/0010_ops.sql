-- 0010_ops.sql
-- The pipeline died silently for two days and nothing alerted. These tables
-- exist so that an OUTPUT measure, not a heartbeat, decides whether the system
-- is alive: last_heartbeat ticked happily through all 48 hours of the outage.
BEGIN;
SELECT insidor.migration_begin('0010', 'ops', '@@CHECKSUM_0010@@');

-- Replaces worker_cycle_log. Every stage writes one row per attempt, from a
-- `finally`, so a thrown cycle still records zero output and the error.
CREATE TABLE IF NOT EXISTS public.ops_stage_run (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stage        text NOT NULL,      -- ingest|ingest-tiktok|snapshotter|score|cluster|resolve-coins|trends|rank-commit
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz,
  ok           boolean NOT NULL DEFAULT false,
  -- The one column that makes SLI-2 work. Each stage sets it from its own
  -- output metric; `ingested` does not mean output everywhere and two of the
  -- four workers that logged at all would otherwise page from day one.
  rows_out     integer NOT NULL DEFAULT 0,
  rows_in      integer,
  api_reads    integer NOT NULL DEFAULT 0,
  cost_usd     numeric(12,6) NOT NULL DEFAULT 0,
  error_code   text,               -- e.g. 402 payment_required
  error_detail text,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb
);
SELECT insidor.add_constraint('public.ops_stage_run', 'ops_stage_run_ok_finished',
  $$CHECK (ok = false OR finished_at IS NOT NULL)$$);
CREATE INDEX IF NOT EXISTS ops_stage_run_stage_idx ON public.ops_stage_run (stage, started_at DESC);
CREATE INDEX IF NOT EXISTS ops_stage_run_errors_idx
  ON public.ops_stage_run (started_at DESC) WHERE error_code IS NOT NULL;

-- The fixed list of stages the SLI query LEFT JOINs against, so a worker that
-- dies before it can log anything emits zero_run_streak = 999 on ABSENCE
-- rather than emitting no row at all. Absence and zero must both breach.
CREATE TABLE IF NOT EXISTS public.ops_stage_expected (
  stage            text PRIMARY KEY,
  interval_seconds integer NOT NULL,
  enabled          boolean NOT NULL DEFAULT true
);
INSERT INTO public.ops_stage_expected(stage, interval_seconds) VALUES
  ('ingest', 180), ('ingest-tiktok', 600), ('snapshotter', 60), ('score', 120),
  ('cluster', 45), ('resolve-coins', 60), ('trends', 300), ('rank-commit', 20)
ON CONFLICT (stage) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ops_event (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind       text NOT NULL,     -- board_fallback|gap_opened|gap_closed|budget_exhausted|schema_assert_failed
  severity   text NOT NULL DEFAULT 'warn',
  stage      text,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
SELECT insidor.add_constraint('public.ops_event', 'ops_event_severity_enum',
  $$CHECK (severity IN ('info','warn','page'))$$);
CREATE INDEX IF NOT EXISTS ops_event_recent_idx ON public.ops_event (created_at DESC);

CREATE TABLE IF NOT EXISTS public.ops_sli_sample (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sli           smallint NOT NULL,
  name          text NOT NULL,
  value         double precision,      -- NULL = could not evaluate
  warn_at       double precision,
  page_at       double precision,
  state         text NOT NULL,         -- ok|warn|page|unknown
  breaching_since timestamptz,
  evaluated_at  timestamptz NOT NULL DEFAULT now()
);
-- A green board painted by an SLI that queried a nonexistent column is exactly
-- how the original outage stayed invisible. NULL is 'unknown', never 'ok'.
SELECT insidor.add_constraint('public.ops_sli_sample', 'ops_sli_null_is_unknown',
  $$CHECK ((value IS NULL) = (state = 'unknown'))$$);
SELECT insidor.add_constraint('public.ops_sli_sample', 'ops_sli_state_enum',
  $$CHECK (state IN ('ok','warn','page','unknown'))$$);
CREATE INDEX IF NOT EXISTS ops_sli_sample_recent_idx ON public.ops_sli_sample (sli, evaluated_at DESC);

-- ARRIVED -> ADMITTED -> TRACKED -> TRIGGERED -> CLUSTERED -> PROMOTED.
-- Nothing in the old repository emitted `promoted`; there was no PROMOTE event
-- at all. The funnel had to be DEFINED before it could be persisted.
CREATE TABLE IF NOT EXISTS public.ops_funnel (
  bucket_at  timestamptz NOT NULL,
  platform   platform NOT NULL,
  arrived    integer NOT NULL DEFAULT 0,
  admitted   integer NOT NULL DEFAULT 0,
  tracked    integer NOT NULL DEFAULT 0,
  triggered  integer NOT NULL DEFAULT 0,
  clustered  integer NOT NULL DEFAULT 0,
  promoted   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_at, platform)
);
SELECT insidor.add_constraint('public.ops_funnel', 'ops_funnel_aligned',
  $$CHECK ((extract(epoch FROM (bucket_at - timestamptz 'epoch'))::bigint % 300) = 0)$$);

CREATE TABLE IF NOT EXISTS public.ops_budget_cap (
  source        text PRIMARY KEY,     -- twitterapi|apify|anthropic|jupiter|helius
  daily_cap_usd numeric(12,2) NOT NULL,
  hard_stop     boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ops_spend (
  utc_date   date NOT NULL,
  source     text NOT NULL,
  reads      bigint NOT NULL DEFAULT 0,
  cost_usd   numeric(12,6) NOT NULL DEFAULT 0,
  breakdown  jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (utc_date, source)
);
-- "no usage recorded today" must be distinguishable from "$0.00 spent".
COMMENT ON TABLE public.ops_spend IS
  'Absence of a row means no data, not zero spend. /ops renders "no usage recorded today" in red for a missing row and $0.00 only for a present row.';

SELECT insidor.migration_end('0010', 'ops', '@@CHECKSUM_0010@@');
COMMIT;
