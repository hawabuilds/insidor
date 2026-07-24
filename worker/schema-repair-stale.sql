-- Repair posted_at after migrations run out of order (safe to re-run).
-- Canonical: posted_at = unix epoch MILLISECONDS.

-- Rows stored as seconds (< 1e12) → multiply once
update public.narrative_posts
set posted_at = posted_at * 1000
where posted_at is not null
  and posted_at > 0
  and posted_at < 1000000000000;

-- Absurd future dates (double-converted) — clamp using first_seen_at if available
update public.narrative_posts
set posted_at = (extract(epoch from first_seen_at) * 1000)::bigint
where posted_at is not null
  and posted_at > extract(epoch from now() + interval '1 day') * 1000
  and first_seen_at is not null;

-- Stale TikTok/X posts already ingested — mark pruned so they leave the live feed
update public.narrative_posts
set tracking_status = 'pruned',
    pruned_at = now()
where tracking_status = 'active'
  and platform_post_id is not null
  and posted_at is not null
  and posted_at < (extract(epoch from now() - interval '24 hours') * 1000)::bigint;

-- Narratives that became display_eligible only because of stale posts
update public.narratives n
set display_eligible = false,
    gate_reason = 'too_old',
    updated_at = now()
where n.display_eligible = true
  and n.source = 'cluster'
  and not exists (
    select 1
    from public.narrative_posts p
    where p.narrative_id = n.id
      and p.posted_at is not null
      and p.posted_at >= (extract(epoch from now() - interval '12 hours') * 1000)::bigint
  );
