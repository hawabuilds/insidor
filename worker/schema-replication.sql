-- Replication signal, ticker proposals, CT pickup, TikTok sound_id

alter table public.narratives
  add column if not exists distinct_authors int not null default 0,
  add column if not exists author_velocity numeric not null default 0,
  add column if not exists ticker_proposals int not null default 0,
  add column if not exists ct_pickup boolean not null default false;

alter table public.narrative_posts
  add column if not exists sound_id text,
  add column if not exists subject_entity text,
  add column if not exists ct_pickup boolean not null default false,
  add column if not exists ticker_proposal_count int not null default 0;

create index if not exists narrative_posts_sound_id_idx
  on public.narrative_posts (sound_id)
  where platform = 'tt' and sound_id is not null;

create index if not exists narratives_author_velocity_idx
  on public.narratives (author_velocity desc)
  where source = 'cluster' and status = 'open';
