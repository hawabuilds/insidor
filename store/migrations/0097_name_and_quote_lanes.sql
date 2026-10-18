-- 0097_name_and_quote_lanes.sql
--
-- TWO MORE WAYS A POST CAN BE FOUND: BY A LIVE NARRATIVE'S NAME, AND AS A QUOTE OF A BIG ACCOUNT.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-18, approved two new text-source searches, each with its own daily cap kept in
-- internal.lane_spend (0088) under its lane's name:
--
--   'narrative_name'  every hour, each narrative on the board searched by its name, forward from
--                     its last search, at a like floor (Policy.feed.narrativeNames, $0.35 a day).
--                     Two of the owner's missed posts named a live narrative.
--   'quote'           the quotes of a held post by an account with 10M+ followers that passed
--                     5,000 likes, asked at about 1 and 3 hours old (Policy.feed.reproductions, $1.00 a
--                     day). A probe found the Tesla 7:55 post this way.
--
-- Unlike the old story-name backfill (internal.item_backfill, judged and never on the feed), posts
-- credited to either lane are judged and may reach For You, like every other found post: the
-- credit is a row here, and every For You read joins this table.
--
-- ── THE LANE CHECK IS REBUILT FROM WHAT IS THERE (0088's pattern) ────────
--
-- A lane value added by a migration this file never saw is kept: the existing values are read from
-- the live check and these two added. No check found stops the migration rather than writing one
-- that admits only the new lanes.
--
-- What breaks if changed carelessly: writing the list out by hand drops any lane a parallel
-- migration added. Until this is applied, both lanes stay quiet: their loops read the ledger before
-- every ask, and a credit the check refuses fails the store, which the loop logs, spending nothing more.

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

  wanted := array(select distinct v from unnest(existing || array['narrative_name', 'quote']) as v order by v);

  alter table internal.item_found_by drop constraint if exists item_found_by_lane_check;
  execute format(
    'alter table internal.item_found_by add constraint item_found_by_lane_check check (lane in (%s))',
    (select string_agg(quote_literal(v), ', ') from unnest(wanted) as v)
  );
end
$$;
