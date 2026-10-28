-- 0148_spend_endpoint_idx.sql
--
-- THE JUDGE COST ALARM'S READ, BY ENDPOINT (2026-10-28, a disk-bound morning on which For You's full
-- rebuild failed every run from 10:12 UTC). Every ten minutes the alarm counts one endpoint's billed calls
-- over the last seven days in hourly buckets (store/src/repo/spend.ts `callBuckets`). internal.spend had
-- only `spend_day_idx` (at), so each read walked a week of every vendor's rows — 41 s of database time
-- a run, among the top five that morning. Indexed on (endpoint, at) with the two columns it sums, the
-- read is that endpoint's rows alone, from the index.
--
-- HOW IT IS APPLIED: built first by hand with CREATE INDEX CONCURRENTLY (the migrator runs a file in one
-- transaction, where CONCURRENTLY cannot run; a plain build would hold every metered call's spend write
-- for the build). This file then finds it built.
--
-- What breaks if changed carelessly: the partial `units > 0` must match the alarm's own filter, or the
-- planner cannot use the index for it.

create index if not exists spend_endpoint_at_idx on internal.spend (endpoint, at) include (usd) where units > 0;
