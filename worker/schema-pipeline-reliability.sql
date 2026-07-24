-- Pipeline reliability: heartbeat + crash log

alter table public.worker_pipeline_state
  add column if not exists last_heartbeat timestamptz,
  add column if not exists pipeline_pid int,
  add column if not exists pipeline_started_at timestamptz;

create table if not exists public.worker_crashes (
  id bigserial primary key,
  ts timestamptz not null default (now() at time zone 'utc'),
  reason text not null,
  stack text,
  uptime_sec numeric
);

alter table public.worker_crashes enable row level security;

drop policy if exists "service worker_crashes" on public.worker_crashes;
create policy "service worker_crashes" on public.worker_crashes for all using (true);

drop policy if exists "anon read worker_crashes" on public.worker_crashes;
create policy "anon read worker_crashes" on public.worker_crashes for select using (true);
