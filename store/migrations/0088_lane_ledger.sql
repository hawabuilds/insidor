-- 0088_lane_ledger.sql
--
-- TWO MORE WAYS A POST CAN BE FOUND, AND WHAT EACH MAY SPEND IN A DAY.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-16, approved two new search lanes, each with its own daily dollar cap:
--
--   'middle'       the text source's catch-all search over posts 15 minutes to 3 hours old at a
--                  fixed like floor, every quarter-hour (Policy.feed.middle). 187 coined posts in
--                  three days climbed past the main lanes' floor after their first ten minutes and
--                  stayed under the slow lane's for hours; this lane is for them.
--   'learned_tag'  the short-video source's newest-first search on the tags the coined-video
--                  training set teaches (Policy.finders.learnedTags). 156 of 161 coined short
--                  videos were found by no lane.
--
-- Each is its own lane value, not 'slow' or 'trend', so the lead-time numbers and the short-video
-- sources review (tools/tiktok-sources.ts) can tell what each lane found first.
--
-- internal.lane_spend holds what each capped lane spent per UTC day: its search bill as metered,
-- plus an estimate of the judging its new posts will cost. It is in the database, not the
-- process, because the runner restarts several times a day: a tally in memory would hand each
-- restart a fresh day's money, and the cap would mean "per deploy".
--
-- ── THE LANE CHECK IS REBUILT FROM WHAT IS THERE ─────────────────────────
--
-- Every earlier lane migration (0030, 0061, 0083, 0084) dropped the check and wrote the whole
-- list out again, so two migrations written side by side each drop the other's value — whichever
-- runs second silently wins. This one reads the values the live check admits and adds its two,
-- so it keeps a lane value added by a migration this file never saw.
--
-- What breaks if changed carelessly: writing the list out by hand again (see above). Until this is
-- applied, both lanes stay quiet: the runner reads its ledger before every ask and asks nothing
-- when it cannot (work/lane-ledger.ts), so a missing table costs finds, never money.

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

  /* No check found means this database is not the one 0084 left: stop rather than write a check
     that admits only the two new lanes and refuses every row already there. */
  if cardinality(existing) = 0 then
    raise exception 'internal.item_found_by_lane_check not found; refusing to rebuild it from nothing';
  end if;

  wanted := array(select distinct v from unnest(existing || array['middle', 'learned_tag']) as v order by v);

  alter table internal.item_found_by drop constraint if exists item_found_by_lane_check;
  execute format(
    'alter table internal.item_found_by add constraint item_found_by_lane_check check (lane in (%s))',
    (select string_agg(quote_literal(v), ', ') from unnest(wanted) as v)
  );
end
$$;

create table internal.lane_spend (
  day        date not null,
  lane       text not null check (length(lane) between 1 and 40),
  usd        double precision not null default 0 check (usd >= 0),
  updated_at timestamptz not null,
  primary key (day, lane)
);

comment on table internal.lane_spend is
  'What each capped search lane spent per UTC day (its metered search bill plus the estimated judging of the posts it found first), read before every ask so a lane cap survives a restart.';
