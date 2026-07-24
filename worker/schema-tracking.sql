-- Post tracking status + worker cycle metrics for stats/diagnostics

alter table public.narrative_posts
  add column if not exists tracking_status text not null default 'active',
  add column if not exists pruned_at timestamptz;

create index if not exists narrative_posts_tracking_status_idx
  on public.narrative_posts (tracking_status)
  where platform_post_id is not null;

create table if not exists public.worker_cycle_log (
  id uuid primary key default gen_random_uuid(),
  worker text not null,
  ran_at timestamptz not null default (now() at time zone 'utc'),
  ingested int,
  skipped_floor int,
  pruned int,
  snapshots_written int
);

create index if not exists worker_cycle_log_worker_ran_idx
  on public.worker_cycle_log (worker, ran_at desc);

alter table public.worker_cycle_log enable row level security;

drop policy if exists "anon read worker_cycle_log" on public.worker_cycle_log;
create policy "anon read worker_cycle_log" on public.worker_cycle_log for select to anon using (true);
