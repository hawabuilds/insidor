-- Measured Anthropic cost breakdown + pipeline pause flag for frontend

alter table public.worker_usage
  add column if not exists cost_breakdown jsonb not null default '{}'::jsonb;

alter table public.worker_usage
  add column if not exists posts_ingested int not null default 0;

create table if not exists public.worker_pipeline_state (
  id int primary key default 1 check (id = 1),
  scoring_paused boolean not null default false,
  pause_reason text,
  anthropic_spent_usd numeric,
  anthropic_budget_usd numeric,
  projected_daily_usd numeric,
  updated_at timestamptz not null default (now() at time zone 'utc')
);

insert into public.worker_pipeline_state (id, scoring_paused)
values (1, false)
on conflict (id) do nothing;

alter table public.worker_pipeline_state enable row level security;

drop policy if exists "service worker_pipeline_state" on public.worker_pipeline_state;
drop policy if exists "anon read worker_pipeline_state" on public.worker_pipeline_state;

create policy "service worker_pipeline_state" on public.worker_pipeline_state for all using (true);
create policy "anon read worker_pipeline_state" on public.worker_pipeline_state for select using (true);
