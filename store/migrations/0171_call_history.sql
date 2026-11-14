-- 0171_call_history.sql
--
-- EVERY CALL'S WHOLE PRICE HISTORY, SO THE CALLS BOARD'S PEAKS ARE THE COIN'S REAL ONES (the owner,
-- 2026-11-14: "some of the coins' ATH was much higher ... make sure it's accurate from now on").
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The board (services/read calls.ts) measured a call's peak from our own candles (0144), which
-- begin when chainwatch first charted a coin: 27 October for the oldest, and after the run for many
-- (a quarter of last week's calls). Those fell back to the market readings, which are minutes apart
-- and miss most of a run. $Kim showed 1.0x ($571K → $588K) against a $15.6M top; 58 of the 145
-- calls with a known top were under it by more than half.
--
-- ── WHAT IS ADDED ────────────────────────────────────────────────────────
--
-- internal.coin_hour        a called coin's hourly candles from its own primary pool, as the market
--                           source draws them: open, high, low, close in dollars per coin, and the
--                           dollars traded in the hour. Written by the runner (work/call-history.ts)
--                           and the one-off backfill (tools/call-history.ts); a re-read replaces an
--                           hour it already holds (the last, unfinished hour changes).
-- internal.coin_hour_read   one row per coin: when its history was last read, from which pool, the
--                           pool's own ticker for the coin (some coins' own row never carried one —
--                           $FTR), and whether the read worked. What decides which coin is read next.
-- public.coin_hour_history  the read service's window on coin_hour: the coin, the hour, its high,
--                           close and dollars traded. Runs as its owner, as 0170's view does,
--                           because the read role is never granted internal.
-- public.coin_hour_ticker   the pool's ticker per coin, for a coin whose own row has none.
-- public.coin_notified      gains `source` at the end ('card' | 'alert', 0145): a moment that is an
--                           alert from before 0145 caught card moments is the stand-in 0145 says it
--                           is, and the board may look for the card's earlier one.
--
-- What breaks if changed carelessly: the key (address, bucket). A re-read must replace an hour, not
-- add a second copy of it, or a run would be counted twice in the dollars traded since a call.

create table internal.coin_hour (
  address    text             not null,
  bucket     timestamptz      not null,
  o          double precision not null,
  h          double precision not null,
  l          double precision not null,
  c          double precision not null,
  volume_usd double precision,
  primary key (address, bucket)
);

comment on table internal.coin_hour is
  'A called coin''s hourly candles from its primary pool, in dollars per coin, with the dollars traded (0171). For the calls board''s peaks.';

create table internal.coin_hour_read (
  address  text        primary key,
  read_at  timestamptz not null,
  status   text        not null check (status in ('read', 'no_pool', 'failed')),
  pool     text,
  ticker   text
);

comment on table internal.coin_hour_read is
  'When each called coin''s hourly history was last read, from which pool, and the pool''s ticker for it (0171).';

create view public.coin_hour_history as
select address, bucket, h, c, volume_usd from internal.coin_hour;

comment on view public.coin_hour_history is
  'Called coins'' hourly highs, closes and dollars traded (0171), for the calls board. Runs as its owner.';

create view public.coin_hour_ticker as
select address, ticker from internal.coin_hour_read where ticker is not null;

comment on view public.coin_hour_ticker is
  'A called coin''s ticker as its pool names it (0171), for a coin whose own row carries none.';

create or replace view public.coin_notified as
select address, shown_at as notified_at, mc_usd, source from internal.coin_shown;

grant select on public.coin_hour_history, public.coin_hour_ticker to insidor_app;
