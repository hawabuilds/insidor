-- Cluster worker — derived narrative stats + post embeddings

alter table public.narratives
  add column if not exists source text not null default 'seed',
  add column if not exists status text not null default 'open',
  add column if not exists combined_views bigint not null default 0,
  add column if not exists platforms jsonb not null default '[]'::jsonb,
  add column if not exists gain_24h bigint not null default 0,
  add column if not exists lifecycle text not null default 'peaking',
  add column if not exists age_min int not null default 0,
  add column if not exists top_post_id uuid references public.narrative_posts(id) on delete set null,
  add column if not exists updated_at timestamptz;

create index if not exists narratives_source_status_idx
  on public.narratives (source, status);

alter table public.narrative_posts
  add column if not exists cluster_match text;

create table if not exists public.post_embeddings (
  post_id uuid primary key references public.narrative_posts(id) on delete cascade,
  embedding jsonb not null,
  updated_at timestamptz not null default (now() at time zone 'utc')
);

alter table public.post_embeddings enable row level security;

drop policy if exists "anon read post_embeddings" on public.post_embeddings;
create policy "anon read post_embeddings" on public.post_embeddings for select to anon using (true);
