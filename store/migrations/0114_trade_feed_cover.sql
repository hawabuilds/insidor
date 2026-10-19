-- 0114_trade_feed_cover.sql
--
-- WHEN EACH WATCHED COIN'S TRADES WERE BEING MEASURED, AND WHAT THE TRADE FEED COST EACH DAY.
--
-- 0112 made the trade tables and said, in capitals, that an empty one is not a quiet coin. Now
-- that chainwatch fills them (one log subscription per coin on internal.coin_watch, on a key
-- billed by the byte), "no rows" has three meanings and the rule must be able to tell them apart:
--
--   measured, no trade yet       the subscription was confirmed and live: a real nothing
--   not measured yet             the subscription was not confirmed (yet), or the feed is off
--   not measured any more        the coin hit its byte cap, the day's cap was hit, the socket
--                                dropped while it was watched, the process restarted, its curve
--                                completed or it trades in another token, or its log was cut and
--                                could not be fetched whole
--
-- So the watch row carries the coverage, written by chainwatch only:
--
--   measured_from      the instant the coin's subscription was confirmed. NULL: never measured.
--   measured_to        the latest instant the feed vouches it was receiving this coin's trades,
--                      unbroken, since measured_from (a heartbeat, moved on every flush while the
--                      socket is live).
--   unmeasured_from    from this instant to the end of the watch, the coin is NOT measured, for
--   unmeasured_reason  the reason named. Once set it is never cleared: trades missed are missed,
--                      and every total after it would be an undercount read as a measurement.
--   data_bytes         the bytes the feed received for this coin, failed transactions included:
--                      the counted figure the per-coin cap is held against.
--
-- And internal.trade_feed_day keeps the day's counted cost, so the daily cap outlives a restart
-- (the 0019 argument: a cap that resets on boot bounds nothing): bytes received, calls made to the
-- chain, and the credits both come to at the billing in force (Policy.oneCoin.tradeFeed).
--
-- ★ A COIN WITH unmeasured_from SET IS UNKNOWN, NEVER ZERO. The one-coin repo reads such a coin as
-- not measured (no trade facts, not 'quiet'), whatever its minute rows say.
--
-- `internal`, written by chainwatch (the internal role) and read by the runner. The runner's own
-- insert into coin_watch names its four columns, so these are NULL on its rows until the feed
-- writes them. What breaks if changed carelessly: the reason list. The rule does not branch on it,
-- but the owner's tools count by it; a writer that invents a reason fails here, loudly.

alter table internal.coin_watch
  add column measured_from     timestamptz,
  add column measured_to       timestamptz,
  add column unmeasured_from   timestamptz,
  add column unmeasured_reason text,
  add column data_bytes        bigint not null default 0 check (data_bytes >= 0),
  add constraint coin_watch_unmeasured_says_why check ((unmeasured_from is null) = (unmeasured_reason is null)),
  add constraint coin_watch_unmeasured_reason check (unmeasured_reason is null or unmeasured_reason in
    ('coin_cap', 'day_cap', 'outage', 'restart', 'refused', 'graduated', 'no_curve', 'other_quote', 'truncated', 'feed_off')),
  add constraint coin_watch_measured_in_order check (measured_to is null or (measured_from is not null and measured_to >= measured_from));

comment on column internal.coin_watch.measured_from is
  'When the trade feed''s subscription for this coin was confirmed (0114). NULL: never measured.';
comment on column internal.coin_watch.measured_to is
  'The latest instant the trade feed vouches it received this coin''s trades unbroken since measured_from (0114).';
comment on column internal.coin_watch.unmeasured_from is
  'From here to the end of the watch this coin is NOT measured, for unmeasured_reason (0114). Never cleared. Its trades are unknown, never zero.';
comment on column internal.coin_watch.data_bytes is
  'Bytes the trade feed received for this coin, failed transactions included: what the per-coin cap is held against (0114).';

create table internal.trade_feed_day (
  day         date primary key,
  bytes       bigint not null check (bytes >= 0),
  rpc_calls   integer not null check (rpc_calls >= 0),
  credits     numeric not null check (credits >= 0),
  updated_at  timestamptz not null
);

comment on table internal.trade_feed_day is
  'The trade feed''s counted cost per UTC day (0114): bytes received on its socket, chain calls made, and the credits they come to at the billing in Policy.oneCoin.tradeFeed. Seeds the daily cap at boot.';
