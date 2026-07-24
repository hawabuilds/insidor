-- Per-lane ingest floors + underutilisation tracking

alter table public.worker_budget_state
  add column if not exists floor_catch_all int not null default 300,
  add column if not exists floor_slow_burn int not null default 1000,
  add column if not exists floor_media int not null default 300,
  add column if not exists ingest_underutilised_since timestamptz,
  add column if not exists floor_min_decay_at timestamptz;

-- Recover from collapsed legacy state (floor_min synced to adaptive_floor)
update public.worker_budget_state
set
  floor_catch_all = least(coalesce(floor_catch_all, 300), 500),
  floor_slow_burn = least(coalesce(floor_slow_burn, adaptive_floor, 1000), 5000),
  floor_media = least(coalesce(floor_media, 300), 500),
  floor_min = least(floor_min, greatest(300, floor(coalesce(floor_catch_all, 300) * 0.25))),
  adaptive_floor = greatest(coalesce(floor_catch_all, 300), coalesce(floor_slow_burn, 1000), coalesce(floor_media, 300))
where id = 1
  and (floor_min > 500 or adaptive_floor > 500);

-- Reset poisoned floors after recency-window bug (chased api_raw=0 falsely)
update public.worker_budget_state
set
  floor_catch_all = 300,
  floor_slow_burn = 1000,
  floor_media = 300,
  floor_min = 300,
  adaptive_floor = 1000,
  updated_at = (now() at time zone 'utc')
where id = 1
  and (floor_catch_all < 300 or floor_slow_burn < 1000 or floor_media < 300 or floor_catch_all > 500);
