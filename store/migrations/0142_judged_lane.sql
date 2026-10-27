-- 0142_judged_lane.sql
--
-- ONE MORE WAY A POST CAN BE FOUND: THE JUDGE PASSED IT WHILE IT WAS FRESH.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- 'judged'   a post the judge called a meme while it was under six hours old that no search lane had
--            credited (services/runner work/credit-judged.ts). Credited here so TRACK re-reads its
--            views and For You may show it when it clears the bar like any found post.
--            2026-10-26: @nexta_tv's video of Chada the bear (1.3M followers) was stored seconds after
--            it went up and judged a meme four minutes later, but no lane had found it, so its views
--            were read once — 0, at second twelve — and never again; it could not clear For You's bar.
--            1,408 such posts in that day, 365 of them stuck at 0 views.
--
-- ── THE LANE CHECK IS REBUILT FROM WHAT IS THERE (0116's pattern) ────────
--
-- A lane value added by a migration this file never saw is kept: the existing values are read from
-- the live check and this one added. No check found stops the migration rather than writing one that
-- admits only the new lane.
--
-- What breaks if changed carelessly: writing the list out by hand drops any lane a parallel migration
-- added.

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

  wanted := array(select distinct v from unnest(existing || array['judged']) as v order by v);

  alter table internal.item_found_by drop constraint if exists item_found_by_lane_check;
  execute format(
    'alter table internal.item_found_by add constraint item_found_by_lane_check check (lane in (%s))',
    (select string_agg(quote_literal(v), ', ') from unnest(wanted) as v)
  );
end
$$;
