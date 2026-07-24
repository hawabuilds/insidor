-- Repair script — safe to run after migrations applied in wrong order.
-- Idempotent: normalizes narrative_posts.posted_at to unix epoch MILLISECONDS.
-- Age logic in the worker uses posted_at only (bigint ms).

-- 1) Fix double-scaled values (seconds converted twice, or ms * 1000 again)
update public.narrative_posts
set posted_at = (posted_at / 1000)::bigint
where posted_at is not null
  and posted_at > 1000000000000000;

-- 2) Seconds → milliseconds (values before year ~2001 when interpreted as ms)
update public.narrative_posts
set posted_at = (posted_at * 1000)::bigint
where posted_at is not null
  and posted_at > 0
  and posted_at < 1000000000000;

-- 3) Optional posted_at_ts column — sync from posted_at if present (ignore if column missing)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'narrative_posts'
      and column_name = 'posted_at_ts'
  ) then
    update public.narrative_posts
    set posted_at_ts = to_timestamp(posted_at / 1000.0)
    where posted_at is not null
      and posted_at >= 1000000000000;
  end if;
end $$;

-- 4) Demote stale posts already in DB (TikTok 24h, X 6h) — keeps rows, stops feed eligibility
update public.narrative_posts
set tracking_status = 'pruned',
    pruned_at = coalesce(pruned_at, now())
where tracking_status = 'active'
  and platform_post_id is not null
  and posted_at is not null
  and (
    (platform = 'tt' and posted_at < (extract(epoch from now() - interval '1440 minutes') * 1000)::bigint)
    or (platform = 'x' and posted_at < (extract(epoch from now() - interval '360 minutes') * 1000)::bigint)
  );
