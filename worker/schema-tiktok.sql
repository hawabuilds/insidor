-- TikTok ingest budget (worker_usage) + cross-platform narrative flag

create table if not exists public.worker_usage (
  source text not null,
  utc_date date not null default (current_date at time zone 'utc'),
  reads_today int not null default 0,
  cost_usd numeric not null default 0,
  updated_at timestamptz not null default (now() at time zone 'utc'),
  primary key (source, utc_date)
);

create index if not exists worker_usage_source_date_idx
  on public.worker_usage (source, utc_date desc);

-- Seed today's rows for known sources (no-op if exists)
insert into public.worker_usage (source, utc_date, reads_today, cost_usd)
values
  ('x', (current_date at time zone 'utc'), 0, 0),
  ('tiktok', (current_date at time zone 'utc'), 0, 0),
  ('apify', (current_date at time zone 'utc'), 0, 0)
on conflict (source, utc_date) do nothing;

alter table public.narratives
  add column if not exists cross_platform boolean not null default false;

alter table public.worker_usage enable row level security;

drop policy if exists "service worker_usage" on public.worker_usage;
create policy "service worker_usage" on public.worker_usage for all using (true);
