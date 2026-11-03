-- 0161_coin_candle_covering_idx.sql
--
-- A COIN'S CHART READ FROM A FEW PAGES INSTEAD OF ONE PAGE PER CANDLE (2026-11-03; the owner, demoing
-- in person every day that week: "some charts take few seconds to load it needs to be instant").
--
-- The token page's chart (services/read own-market.ts CANDLES_SQL) reads a coin's candles by the
-- primary key (coin_id, bucket), then fetches each row from the table. The table is written a minute
-- at a time for every coin at once, so one coin's rows lie one to a page across the whole table:
-- measured that night, a 15-minute view (about 5,000 minute rows) took 21–43 s on the disk-bound
-- database, and a 4-hour view (about 150 hour rows) 0.3–0.7 s.
--
-- These indexes carry the candle's own prices (o, h, l, c) beside its key, so the same query is
-- answered from the index alone, where one coin's rows sit together in key order: a few pages, not
-- thousands. Same rows, same order: an index changes how they are found, never which.
--
-- The write cost is small: 98% of the minute table's updates were already not HOT (measured: 1,415
-- updates a minute, 30 HOT), so nearly every write already touched the primary key's index.
--
-- HOW IT IS APPLIED: as 0146 and 0160, built first by hand with CREATE INDEX CONCURRENTLY (the
-- migrator runs each file in a transaction, where CONCURRENTLY cannot run, and a plain build would
-- hold chainwatch's candle writes while it reads the table). This file then finds them built and does
-- nothing. On a fresh database the tables are small and the plain build here is instant.
--
-- What breaks if changed carelessly: the INCLUDE list must hold every column CANDLES_SQL reads
-- (bucket is in the key; o, h, l, c included), or the planner goes back to the table for each row and
-- the chart is slow again.

create index if not exists coin_candle_1m_chart_idx on internal.coin_candle_1m (coin_id, bucket) include (o, h, l, c);

create index if not exists coin_candle_1h_chart_idx on internal.coin_candle_1h (coin_id, bucket) include (o, h, l, c);
