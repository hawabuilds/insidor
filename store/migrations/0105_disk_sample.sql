-- 0105_disk_sample.sql
--
-- THE DATABASE'S SIZE, ONCE AN HOUR: what the owner's disk and bill alerts read, and the 20:00
-- table's growth per day.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-18: let the database's disk grow past 8 GB, and tell me when it is filling
-- and when the bill is heading over $40. The host grows the disk by itself (at 90% full, by half,
-- at most once in four hours) and bills the disk it has provisioned, not what is used; neither the
-- provisioned size nor the bill can be read from SQL. What can be read is the database's own size,
-- so the runner samples it each hour (services/runner disk-alarm.ts) and the provisioned size is
-- replayed from these rows by the host's own rule. A size inferred from history instead of stored
-- means a restart, a missed hour or a changed rule never leaves a stale number in a column.
--
-- ── WHAT A ROW HOLDS ─────────────────────────────────────────────────────
--
-- at             the hour, truncated: one row an hour however often the job runs (a second write
--                in the same hour replaces the first, so the latest reading of the hour wins).
-- db_bytes       pg_database_size(current_database()). Not the disk: the write-ahead log, the
--                host's own files and other databases are on the same disk and are not counted,
--                so the real disk is fuller than this says.
-- storage_bytes  the sum of the file buckets' object sizes (storage.objects metadata), billed
--                apart from the disk. NULL when the role could not read them: an unread size is
--                not an empty bucket, and the bill says the part is unknown rather than $0.
--
-- What breaks if changed carelessly: deleting old rows changes the inferred disk size, because the
-- replay starts from the policy's first size at the first row. Keep the rows (24 a day, a few KB a
-- month), or move the policy's starting size and date together with any pruning.

create table internal.disk_sample (
  at             timestamptz primary key,
  db_bytes       bigint not null check (db_bytes > 0),
  storage_bytes  bigint check (storage_bytes is null or storage_bytes >= 0),
  sampled_at     timestamptz not null default now()
);

comment on table internal.disk_sample is
  'The database''s own size (pg_database_size, WAL not counted) and the file buckets'' size, one row an hour (0105). Read by the runner''s disk and bill alerts, which replay the provisioned disk size from these rows, and by the 20:00 table (tools/name-report.ts). storage_bytes NULL: not readable, never zero.';

grant select, insert, update on internal.disk_sample to insidor_internal;
grant select on internal.disk_sample to insidor_service;
