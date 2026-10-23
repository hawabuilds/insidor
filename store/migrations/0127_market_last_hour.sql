-- 0127_market_last_hour.sql
--
-- EACH MARKET READING KEEPS THE COIN'S LAST HOUR OF TRADING: DOLLAR VOLUME, BUYS AND SELLS.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-23, on the running coins strip: "coins that have volume right now — I don't
-- want to see few-day-old dead coins." The strip ordered by the 24-hour move, and a coin that rose
-- 1,000% yesterday and has not traded since still carried that move. What says a coin is trading
-- NOW is its last hour.
--
-- The market reader already asks the market source for every coin we hold every few minutes, and
-- that answer already carries each pool's last-hour dollar volume and its buy and sell counts. They
-- were dropped on the floor. Keeping them costs no call. The trade feed's tables (0112, 0114) were
-- the other candidate and do not cover these coins: they watch a new launch's first hour only, stop
-- at graduation, and stop for the day at the feed's cap (07:06 UTC on 23 Oct).
--
-- ── THE COLUMNS ──────────────────────────────────────────────────────────
--
--   volume_1h_usd     dollars traded in the coin's pools over the hour before taken_at
--   buys_1h           buy transactions in that hour, summed over the coin's pools
--   sells_1h          sell transactions in that hour
--   last_hour_absent  why the three are not there, from MARKET_ABSENCE_REASONS
--
-- A real zero stays zero: a pool that reported an hour with no trade is a measured quiet hour.
-- The three numbers come from one answer and are kept or missing together.
--
-- ★ ROWS WRITTEN BEFORE THIS MIGRATION HAVE NEITHER A NUMBER NOR A REASON. The table is append-only
-- (0010), so they cannot be back-filled, and the constraints below are NOT VALID: they hold every
-- row written from now on and leave the old ones as they are. A reader meets such a row as "not
-- read" (the projector says `not_read_yet`), never as an hour with no trading.
--
-- What breaks if changed carelessly: the reason list. It is MARKET_ABSENCE_REASONS, the same list
-- the four 0010 reason columns check, and store/src/migrations.test.ts asserts all five agree.

alter table public.market_reading
  add column volume_1h_usd    double precision,
  add column buys_1h          integer,
  add column sells_1h         integer,
  add column last_hour_absent text;

alter table public.market_reading
  add constraint last_hour_xor_reason check
    ((volume_1h_usd is null) = (last_hour_absent is not null)) not valid,
  add constraint last_hour_together check
    ((volume_1h_usd is null) = (buys_1h is null) and (volume_1h_usd is null) = (sells_1h is null)) not valid,
  add constraint last_hour_absent_is_a_known_reason check
    (last_hour_absent in ('no_market', 'not_reported', 'unreadable')),
  add constraint last_hour_is_not_negative check
    (coalesce(volume_1h_usd, 0) >= 0 and coalesce(buys_1h, 0) >= 0 and coalesce(sells_1h, 0) >= 0);

comment on column public.market_reading.volume_1h_usd is
  'Dollars traded in the coin''s pools in the hour before taken_at, as the market source said (0127). 0 is a measured quiet hour. NULL with last_hour_absent: why not; NULL with no reason: written before 0127, not read.';
comment on column public.market_reading.buys_1h is
  'Buy transactions in that hour, summed over the coin''s pools (0127). NULL exactly when volume_1h_usd is.';
comment on column public.market_reading.sells_1h is
  'Sell transactions in that hour, summed over the coin''s pools (0127). NULL exactly when volume_1h_usd is.';
