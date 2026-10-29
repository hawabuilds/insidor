-- 0153_disk_sample_reads.sql
--
-- THE ROWS THE DATABASE SENT EACH HOUR, BESIDE ITS SIZE: what the owner's transfer alert reads.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- On 2026-10-29 the host restricted the project for passing the plan's 250 GB of transfer a month,
-- and the owner keeps the spend cap on. The host's own count is not readable from SQL (its
-- management API needs a token we do not hold), so the runner estimates it: each hour it reads
-- pg_stat_statements, sums, statement by statement, the rows the read statements returned since
-- its previous reading, and writes the sum here. Policy.store.transfer turns rows into bytes.
--
-- ── WHAT A ROW GAINS ─────────────────────────────────────────────────────
--
-- read_rows   rows returned by statements that are not writes, during the hour before `sampled_at`.
--             NULL when unknown: the runner's first hour after a start (it has no previous reading
--             to subtract), or a role that cannot read pg_stat_statements. An unknown hour is filled
--             with the month's average by the alert, never counted as zero.
--
-- What breaks if changed carelessly: storing the cumulative counter instead of the hour's sum makes
-- a reset or an evicted statement look like negative traffic and a restart like a month's worth.

alter table internal.disk_sample add column read_rows bigint check (read_rows is null or read_rows >= 0);

comment on column internal.disk_sample.read_rows is
  'Rows returned by read statements (pg_stat_statements, per-statement deltas) in the hour before sampled_at (0153). NULL: unknown (first hour after a runner start, or no access), never zero. Read by the runner''s transfer alert (Policy.store.transfer).';
