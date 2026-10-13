-- 0060_older_coin.sql
--
-- OLDER COINS NAMED FOR A FEED POST'S SUBJECT, AND WHETHER THEIR TRADING JUMPED AFTER THE POST.
--
-- A post's name search (internal.coin_lookup, the runner's coin-lookup step) keeps only coins
-- launched in the last `universe.lookup.withinMs`, because only a coin launched after the post
-- can be its coin. But the search also sees coins launched long before, and one of those named
-- for the same subject can run on the news (the Goliath coaster posts of 12 October 2026: the
-- coin traders bought was "The Goliath Expedition", launched in May). That coin is NEVER the
-- post's coin and never gets a Buy on the card; the card says, on a line of its own, that an
-- older coin of this name traded more since the post, with the numbers.
--
-- One row per (post, coin): written by the lookup when a post's search returns a coin whose
-- market was created before the post, and filled in by the runner's older-coins step:
--
--   outcome        'waiting'       found, not measured yet
--                  'name_differs'  the search's fuzzy hit does not carry the subject's name
--                                  (core `nameMatch` against the judge's names): never measured
--                  'read'          measured; the numbers below are the coin's own candles
--                  'unavailable'   the market source failed; tried again on later passes
--   hour_before_usd   dollars traded per hour, averaged over the day before the post
--   peak_hour_usd     the busiest hour since the post, in dollars
--   price_at_post_usd / price_since_usd   the last trade price before the post, and since
--   running        the step's bars applied (core `olderCoinRun`); only `true` rows are projected
--
-- `internal`: the rows are read by the projector, which writes the facts of the running ones
-- into the feed row (public.rising_row). Nothing here is a judgement about the coin — volume and
-- price are facts about the world, true whether or not Insidor exists.
--
-- What breaks if changed carelessly: `launched_at` is the search's market time — for a coin
-- that left its curve, the pool's, which is AFTER its launch. That errs the safe way: a coin
-- whose pool predates the post was launched before it too. Never fill it with a guess; a null
-- launch is not stored at all, since an unknown launch cannot be called older.

create table internal.older_coin (
  item_id           text not null,
  address           text not null,
  name              text,
  ticker            text,
  launched_at       timestamptz not null,
  found_at          timestamptz not null,
  outcome           text not null default 'waiting'
                    check (outcome in ('waiting', 'name_differs', 'read', 'unavailable')),
  checks            integer not null default 0 check (checks >= 0),
  checked_at        timestamptz,
  last_error        text,
  hour_before_usd   double precision check (hour_before_usd is null or hour_before_usd >= 0),
  peak_hour_usd     double precision check (peak_hour_usd is null or peak_hour_usd >= 0),
  price_at_post_usd double precision,
  price_since_usd   double precision,
  running           boolean not null default false,
  primary key (item_id, address)
);

create index older_coin_running_idx on internal.older_coin (item_id) where running;
create index older_coin_due_idx on internal.older_coin (checked_at nulls first) where outcome in ('waiting', 'read', 'unavailable');

comment on table internal.older_coin is
  'Coins launched before a feed post that its name search returned, and whether their trading jumped after the post. Never the post''s coin.';
comment on column internal.older_coin.launched_at is
  'The search''s market time: for a coin off its curve, the pool''s, which is after its launch. Never a guess.';
comment on column internal.older_coin.hour_before_usd is
  'Dollars traded per hour, averaged over the day before the post. Null: not measured.';
comment on column internal.older_coin.peak_hour_usd is
  'The busiest hour since the post, in dollars. Null: not measured, or nothing since the post yet.';
