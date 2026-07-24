-- Views-primary metrics — post scores + narrative ranking fields

alter table public.post_meme_scores
  add column if not exists views_velocity numeric,
  add column if not exists engagement_velocity numeric;

alter table public.narratives
  add column if not exists display_eligible boolean not null default false,
  add column if not exists views_velocity numeric not null default 0,
  add column if not exists accel numeric not null default 0,
  add column if not exists engagement_velocity numeric,
  add column if not exists bought_reach boolean not null default false,
  add column if not exists first_seen_at timestamptz;

-- Seed/mock narratives stay visible in Layer 3 dev
update public.narratives
set display_eligible = true
where source = 'seed' or source is null;

create index if not exists narratives_display_eligible_idx
  on public.narratives (display_eligible)
  where display_eligible = true;

create index if not exists narratives_views_velocity_idx
  on public.narratives (views_velocity desc)
  where source = 'cluster' and display_eligible = true;
