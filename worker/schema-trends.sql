-- Google Trends enrichment (SerpAPI) — trend_term, peak, direction

alter table public.narratives
  add column if not exists trend_term text,
  add column if not exists trend_peak int,
  add column if not exists trend_direction text;

alter table public.narratives
  alter column search_series drop not null;

alter table public.narratives
  alter column search_series drop default;

create index if not exists narratives_trend_term_idx
  on public.narratives (trend_term)
  where trend_term is not null;
