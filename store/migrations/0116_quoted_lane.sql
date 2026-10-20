-- 0116_quoted_lane.sql
--
-- ONE MORE WAY A POST CAN BE FOUND: A BIG ACCOUNT REPRODUCED IT.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- 'quoted'   a post we already stored that a big account (Policy.judge.reproductionBoost) then quoted, or
--            reposted the same picture or video of, under its own name. The original is judged at
--            once, whatever its views (services/runner/src/work/early-judge.ts), and credited here so
--            TRACK re-reads it and For You may show it when it clears the bar like any found post.
--            2026-10-20: AlexesNakamoto's AI-presenter video was stored at 1k views and never judged;
--            Michael Saylor reposted the same video 41 minutes later, and a coin on it ran.
--
-- The judging is charged to internal.lane_spend (0088) under the same name, which holds any lane
-- name and needs no change.
--
-- ── THE LANE CHECK IS REBUILT FROM WHAT IS THERE (0088's, 0097's and 0115's pattern) ─
--
-- A lane value added by a migration this file never saw is kept: the existing values are read from
-- the live check and this one added. No check found stops the migration rather than writing one
-- that admits only the new lane.
--
-- What breaks if changed carelessly: writing the list out by hand drops any lane a parallel
-- migration added. Until this is applied the boost judges but cannot credit: the credit fails, is
-- logged, and the original is not re-read.

do $$
declare
  existing text[];
  wanted   text[];
begin
  select coalesce(array_agg(distinct m[1]), '{}')
    into existing
    from pg_constraint c,
         regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g') as m
   where c.conname = 'item_found_by_lane_check'
     and c.conrelid = 'internal.item_found_by'::regclass;

  if cardinality(existing) = 0 then
    raise exception 'internal.item_found_by_lane_check not found; refusing to rebuild it from nothing';
  end if;

  wanted := array(select distinct v from unnest(existing || array['quoted']) as v order by v);

  alter table internal.item_found_by drop constraint if exists item_found_by_lane_check;
  execute format(
    'alter table internal.item_found_by add constraint item_found_by_lane_check check (lane in (%s))',
    (select string_agg(quote_literal(v), ', ') from unnest(wanted) as v)
  );
end
$$;
