-- 0163_candle_archive_day.sql
--
-- EVERY MINUTE CANDLE KEPT FOREVER: A DAY LEAVES THE DATABASE ONLY ONCE ITS COPY IS CHECKED (the owner,
-- 2026-11-03: "i want to keep candles never delete" — then "move to cheap storage").
--
-- Until now chainwatch deleted minute candles older than a week (services/chainwatch chart.ts,
-- MINUTE_RETENTION_MS) and kept no copy: a coin's minute history past a week was gone. From this
-- migration, tools/archive-candles.ts writes each finished UTC day of internal.coin_candle_1m to the
-- private bucket `candle-archive`, reads every part back, checks its SHA-256 and line count, compares
-- the sum with the database's own count of the day, and only then writes that day's row here.
--
-- This table is the gate: chainwatch's weekly clean-up (store coin-chart.ts `prune`) deletes a minute
-- row only when its UTC day has a row here. No row, no delete — so a broken or late copy job keeps the
-- candles in the database instead of losing them.
--
-- What breaks if changed carelessly: writing a row here for a day whose copy was not read back and
-- counted. That row is the only thing that lets a day be deleted.

create table if not exists internal.candle_archive_day (
  day         date primary key,
  rows        bigint not null,
  parts       integer not null,
  bytes       bigint not null,
  folder      text not null,
  archived_at timestamptz not null default now()
);

comment on table internal.candle_archive_day is
  'Each UTC day of minute candles copied to the candle-archive bucket and checked (0163). chainwatch deletes a minute candle only when its day is here.';

grant select on internal.candle_archive_day to insidor_internal;
