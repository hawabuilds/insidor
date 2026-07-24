-- Insidor Layer 3 — narratives schema
-- Run once in Supabase SQL editor (Dashboard → SQL → New query).

create table if not exists public.narratives (
  id text primary key,
  title text not null,
  blurb text not null,
  img_seed int not null default 0,
  created_at bigint not null,
  narr_idx int not null default -1,
  search_series jsonb not null default '[]'::jsonb,
  lead_time_min int,
  organic_score int
);

create table if not exists public.narrative_posts (
  id uuid primary key default gen_random_uuid(),
  narrative_id text not null references public.narratives(id) on delete cascade,
  sort_order int not null default 0,
  platform text not null,
  handle text not null,
  text text not null,
  followers int,
  image boolean not null default true,
  views int not null default 0,
  replies int not null default 0,
  quotes int not null default 0,
  notable boolean not null default false,
  sample_replies jsonb not null default '[]'::jsonb,
  posted_at bigint,
  unique (narrative_id, sort_order)
);

create table if not exists public.narrative_tickers (
  id uuid primary key default gen_random_uuid(),
  narrative_id text not null references public.narratives(id) on delete cascade,
  ticker text not null,
  name text not null,
  mcap numeric not null default 0,
  liquidity numeric not null default 0,
  vol24h numeric not null default 0,
  holders int not null default 0,
  age_min int not null default 0,
  first_deployed boolean not null default false,
  endorsed_by text,
  canonical boolean not null default false,
  safety jsonb,
  smart_money jsonb,
  unique (narrative_id, ticker)
);

create index if not exists narrative_posts_narrative_id_idx on public.narrative_posts(narrative_id);
create index if not exists narrative_tickers_narrative_id_idx on public.narrative_tickers(narrative_id);
create index if not exists narrative_tickers_ticker_idx on public.narrative_tickers(ticker);

alter table public.narratives enable row level security;
alter table public.narrative_posts enable row level security;
alter table public.narrative_tickers enable row level security;

drop policy if exists "anon read narratives" on public.narratives;
drop policy if exists "anon read narrative_posts" on public.narrative_posts;
drop policy if exists "anon read narrative_tickers" on public.narrative_tickers;

create policy "anon read narratives" on public.narratives for select to anon using (true);
create policy "anon read narrative_posts" on public.narrative_posts for select to anon using (true);
create policy "anon read narrative_tickers" on public.narrative_tickers for select to anon using (true);
