-- Meme scores cache — one row per post (never scored twice)

create table if not exists public.post_meme_scores (
  post_id uuid primary key references public.narrative_posts(id) on delete cascade,
  meme_score numeric not null default 0 check (meme_score >= 0 and meme_score <= 1),
  reason text,
  suggested_ticker text,
  suggested_name text,
  velocity numeric,
  views_velocity numeric,
  engagement_velocity numeric,
  scored_at timestamptz not null default (now() at time zone 'utc'),
  model text,
  raw jsonb
);

create index if not exists post_meme_scores_scored_at_idx
  on public.post_meme_scores (scored_at desc);

create index if not exists post_meme_scores_meme_score_idx
  on public.post_meme_scores (meme_score desc);

alter table public.post_meme_scores enable row level security;

drop policy if exists "anon read post_meme_scores" on public.post_meme_scores;
create policy "anon read post_meme_scores" on public.post_meme_scores for select to anon using (true);
