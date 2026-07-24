-- Budget tracking, adaptive floor, near-miss recall, snapshot tiers

create table if not exists public.worker_budget_state (
  id int primary key default 1 check (id = 1),
  utc_date date not null default (current_date at time zone 'utc'),
  reads_today int not null default 0,
  adaptive_floor int not null default 1000,
  floor_min int not null default 300,
  media_lane_pct numeric not null default 0.25,
  updated_at timestamptz not null default (now() at time zone 'utc')
);

insert into public.worker_budget_state (id, utc_date, reads_today, adaptive_floor, floor_min)
values (1, (current_date at time zone 'utc'), 0, 1000, 300)
on conflict (id) do nothing;

create table if not exists public.ingest_near_miss (
  platform_post_id text primary key,
  platform text not null default 'x',
  views int not null default 0,
  likes int,
  first_seen_at timestamptz not null default (now() at time zone 'utc'),
  last_checked_at timestamptz not null default (now() at time zone 'utc'),
  raw jsonb
);

create index if not exists ingest_near_miss_views_idx
  on public.ingest_near_miss (views desc);

create index if not exists ingest_near_miss_first_seen_idx
  on public.ingest_near_miss (first_seen_at);

alter table public.worker_budget_state
  add column if not exists media_lane_pct numeric not null default 0.25;

alter table public.narrative_posts
  add column if not exists last_snapshot_at timestamptz,
  add column if not exists snapshot_tier text;

alter table public.worker_cycle_log
  add column if not exists reads_consumed int,
  add column if not exists adaptive_floor int,
  add column if not exists budget_note text;

alter table public.worker_budget_state enable row level security;
alter table public.ingest_near_miss enable row level security;

drop policy if exists "service worker_budget_state" on public.worker_budget_state;
drop policy if exists "service ingest_near_miss" on public.ingest_near_miss;

create policy "service worker_budget_state" on public.worker_budget_state for all using (true);
create policy "service ingest_near_miss" on public.ingest_near_miss for all using (true);
