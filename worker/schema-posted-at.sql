-- posted_at_ts — canonical timestamptz for post age; posted_at bigint stays ms epoch for compat

alter table public.narrative_posts
  add column if not exists posted_at_ts timestamptz;

-- Backfill from legacy posted_at (seconds if < 1e12, else milliseconds)
update public.narrative_posts
set posted_at_ts = case
  when posted_at is null then null
  when posted_at < 1000000000000 then to_timestamp(posted_at::double precision)
  else to_timestamp(posted_at::double precision / 1000.0)
end
where posted_at_ts is null and posted_at is not null;

-- Normalize bigint to milliseconds (legacy seconds rows)
update public.narrative_posts
set posted_at = posted_at * 1000
where posted_at is not null
  and posted_at > 0
  and posted_at < 1000000000000;

create index if not exists narrative_posts_posted_at_ts_idx
  on public.narrative_posts (posted_at_ts desc nulls last);
