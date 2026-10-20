-- 0115_account_lane.sql
--
-- ONE MORE WAY A POST CAN BE FOUND: THE ACCOUNT WATCH.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- 'account'  the newest posts of the text source's accounts whose posts were coined again and again
--            (Policy.feed.accountWatch, services/runner/src/work/account-watch.ts), asked every few
--            minutes, many accounts to a search. Replayed on the coined posts of 2026-10-13 to
--            2026-10-20: the catch-all searches found a big account's coined post a median of hours
--            after it went up, or only when the coin named it; this lane finds it within minutes.
--
-- Its spend is kept in internal.lane_spend (0088) under the same name, which holds any lane name and
-- needs no change. Posts credited here are judged and may reach For You like any found post: the
-- credit is a row in internal.item_found_by, and every For You read joins that table.
--
-- ── THE LANE CHECK IS REBUILT FROM WHAT IS THERE (0088's and 0097's pattern) ─
--
-- A lane value added by a migration this file never saw is kept: the existing values are read from
-- the live check and this one added. No check found stops the migration rather than writing one
-- that admits only the new lane.
--
-- What breaks if changed carelessly: writing the list out by hand drops any lane a parallel
-- migration added. Until this is applied the lane stays quiet: a credit the check refuses fails the
-- store, which the loop logs, and its ledger has been charged only for the page already asked.

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

  wanted := array(select distinct v from unnest(existing || array['account']) as v order by v);

  alter table internal.item_found_by drop constraint if exists item_found_by_lane_check;
  execute format(
    'alter table internal.item_found_by add constraint item_found_by_lane_check check (lane in (%s))',
    (select string_agg(quote_literal(v), ', ') from unnest(wanted) as v)
  );
end
$$;
