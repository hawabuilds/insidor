-- 0035_coin_lookup.sql
--
-- WHICH NARRATIVES AND POSTS HAVE HAD THEIR NAME SEARCHED FOR COINS, AND WHEN.
--
-- A promoted narrative, or a For You post, with no coin may still have one: launched before
-- the mint stream was watching, or never traded through a pool we read. Its name is searched on
-- the market data sources and launchpad coins found go into the universe as candidates
-- (public.asset, origin 'backfill') — checked like any coin, never linked by the search itself.
--
-- This table is what makes the search happen once per `universe.lookup.keepMs`, what the daily
-- cap is counted against, and what lets the projector tell "searched, nothing found" from "not
-- searched yet". Until a subject has a row, a story with no coin shows a dash, never "no coin
-- yet": saying none exists before looking would be a claim about the world we had not checked.
--
-- `internal`, no grant: which names we searched is our reasoning.

create table internal.coin_lookup (
  subject_kind  text not null check (subject_kind in ('story', 'post')),
  subject_id    text not null,
  term          text not null check (length(term) > 0),
  looked_at     timestamptz not null,
  -- Launchpad coins the sources returned for the term, and how many were new to the universe.
  found         integer not null check (found >= 0),
  added         integer not null check (added >= 0 and added <= found),
  primary key (subject_kind, subject_id)
);

create index coin_lookup_day_idx on internal.coin_lookup (looked_at);

comment on table internal.coin_lookup is
  'When each narrative''s or For You post''s name was last searched for coins, and what came back. Candidates only; a search never links.';
