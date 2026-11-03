-- 0162_coin_candle_autovacuum.sql
--
-- THE CHART INDEXES (0161) STAY INDEX-ONLY, BY VACUUMING THE CANDLE TABLES OFTEN.
--
-- 0161's indexes answer a chart from the index alone only for rows on pages the visibility map marks
-- all-visible; any other row is fetched from the table, one page per row, as before. A chart reads a
-- coin's most recent candles, which sit on exactly the pages written since the last vacuum. Measured
-- 3 Nov, after 0161 and before any vacuum: a 15-minute view still made 4,174 table fetches of 7,913
-- rows and took 3.8 s; after one VACUUM, 0.1–0.2 s over the app's own route for every view.
--
-- The defaults vacuum a table when a fifth of it has changed: for the minute table (6.4M rows,
-- ~2,100 inserts and updates a minute) that is about every day and a half, so a day's charts would
-- slow again between runs. At 1% it is every half hour or so. A vacuum skips pages already
-- all-visible, so each run reads only the recent pages: cheap.
--
-- How 0161 was applied, for the record: the hour index by hand, CONCURRENTLY; the minute index by
-- 0161's own plain build (61 s, holding chainwatch's candle writes for that minute) after a
-- concurrent attempt hit its lock timeout.
--
-- What breaks if changed carelessly: raising these back to the defaults. Nothing fails — the charts
-- just drift back to seconds through the day.

alter table internal.coin_candle_1m set (autovacuum_vacuum_scale_factor = 0.01, autovacuum_vacuum_insert_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.02);

alter table internal.coin_candle_1h set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02);
