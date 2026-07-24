-- Display eligibility — narratives graduate into the UI when combined_views crosses threshold
-- (also applied in worker/schema-views-metrics.sql — safe to run either or both)

alter table public.narratives
  add column if not exists display_eligible boolean not null default false;

create index if not exists narratives_display_eligible_idx
  on public.narratives (display_eligible)
  where display_eligible = true;

-- Seed/mock narratives stay visible in Layer 3 dev
update public.narratives
set display_eligible = true
where source = 'seed' or source is null;
