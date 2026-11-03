-- 0165_market_reading_covering_idx.sql
--
-- A COIN'S MARKET READINGS READ FROM THE INDEX, NOT ONE TABLE PAGE PER READING (2026-11-03, the
-- database at 99% that night; the owner demoing in person every day that week).
--
-- market_reading_latest_idx (asset_key, taken_at desc) finds a coin's readings, but every reading is
-- then fetched from the table, where a coin's rows lie one to a page among every other coin's. The
-- one-coin step's `marketFacts` (store one-coin.ts: newest cap and liquidity, peak since) ran 1.3 s
-- on average over 133,649 calls and up to 27 s that night; the running coins strip (public.tape_coin,
-- 0141) and the projector's latest reading per coin read the same way.
--
-- This index has the same key and carries the columns those reads use, so they are answered from the
-- index alone, a coin's readings side by side. It replaces market_reading_latest_idx — same key,
-- same order, so every plan that used the old one can use this one — which is then dropped: one index
-- of this shape to keep up on each insert, not two. Same rows, same values: an index changes how they
-- are found, never which.
--
-- Readings are only ever inserted (never updated), so autovacuum's insert threshold keeps the pages
-- all-visible; it is lowered here so a day's readings are not left to the table for a day and a half.
--
-- HOW IT IS APPLIED: built first by hand with CREATE INDEX CONCURRENTLY and the old index dropped
-- CONCURRENTLY (the migrator runs each file in a transaction, where neither can run, and a plain
-- build would hold the market reader's writes). This file then finds the work done. On a fresh
-- database the table is small and the plain statements here are instant.
--
-- What breaks if changed carelessly: dropping the old index before this one is valid (every latest-
-- reading read would scan the table), or an INCLUDE list missing a column those reads take.

create index if not exists market_reading_latest_cover_idx on public.market_reading (asset_key, taken_at desc)
  include (market_cap_usd, liquidity_usd, volume_1h_usd, buys_1h, sells_1h, price_change_24h_pct, tradable);

drop index if exists public.market_reading_latest_idx;

alter table public.market_reading set (autovacuum_vacuum_insert_scale_factor = 0.02);
