-- Vercel Cron: per-stage last_run, resumable progress, persisted pipeline memory

alter table public.worker_pipeline_state
  add column if not exists last_run_ingest timestamptz,
  add column if not exists last_run_snapshot timestamptz,
  add column if not exists last_run_score timestamptz,
  add column if not exists last_run_cluster timestamptz,
  add column if not exists last_run_trends timestamptz,
  add column if not exists last_catch_all_at timestamptz,
  add column if not exists last_slow_burn_at timestamptz,
  add column if not exists last_near_miss_at timestamptz,
  add column if not exists ingest_degraded_mode boolean default false,
  add column if not exists tt_hashtag_cursor int default 0,
  add column if not exists tt_velocity_unreliable boolean,
  add column if not exists last_health_alarm_at timestamptz;

create table if not exists public.worker_cron_progress (
  stage text primary key,
  progress jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default (now() at time zone 'utc')
);

alter table public.worker_cron_progress enable row level security;

drop policy if exists "service worker_cron_progress" on public.worker_cron_progress;
create policy "service worker_cron_progress" on public.worker_cron_progress for all using (true);

create table if not exists public.worker_trend_cache (
  term text primary key,
  result jsonb not null,
  fetched_at timestamptz not null default (now() at time zone 'utc')
);

alter table public.worker_trend_cache enable row level security;

drop policy if exists "service worker_trend_cache" on public.worker_trend_cache;
create policy "service worker_trend_cache" on public.worker_trend_cache for all using (true);
