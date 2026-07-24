-- Layer 3 ingest + snapshots — run after worker/schema.sql

alter table public.narrative_posts
  add column if not exists platform_post_id text,
  add column if not exists first_seen_at timestamptz,
  add column if not exists raw jsonb,
  add column if not exists filter_label text,
  add column if not exists likes int,
  add column if not exists retweets int,
  add column if not exists media_url text,
  add column if not exists media_type text;

-- narrative_id nullable for unclustered ingested posts
alter table public.narrative_posts alter column narrative_id drop not null;

create unique index if not exists narrative_posts_platform_post_uidx
  on public.narrative_posts (platform, platform_post_id);

create index if not exists narrative_posts_first_seen_at_idx
  on public.narrative_posts (first_seen_at desc)
  where first_seen_at is not null;

create table if not exists public.post_snapshots (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.narrative_posts(id) on delete cascade,
  captured_at timestamptz not null default (now() at time zone 'utc'),
  views int,
  replies int,
  quotes int,
  likes int,
  retweets int,
  bookmarks int,
  unavailable boolean not null default false,
  raw jsonb
);

create index if not exists post_snapshots_post_id_captured_idx
  on public.post_snapshots (post_id, captured_at desc);

alter table public.post_snapshots enable row level security;

drop policy if exists "anon read post_snapshots" on public.post_snapshots;
create policy "anon read post_snapshots" on public.post_snapshots for select to anon using (true);
