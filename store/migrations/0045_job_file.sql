-- 0045_job_file.sql
--
-- FILES A ONE-OFF JOB MUST NOT LOSE WHEN ITS CONTAINER ENDS.
--
-- The paid jobs (tools/jobs.ts: the gold evidence stages, the origin eval report, the history
-- pilot) write their progress and results to files. On a laptop those files stay; in a hosted
-- one-off container they vanish with it. So the job copies each file here as it changes and reads
-- it back when it starts, which is also what makes a stopped job resume instead of paying for the
-- same pictures twice. `tools/jobs.ts pull` writes them back to disk, where the gold files are
-- committed.
--
-- One row per path, replaced wholesale: the latest copy is the only one anybody reads. A path is
-- repo-relative ("eval/src/gold/coin-evidence.json"), never absolute, so a container and a laptop
-- name the same file the same way.
--
-- `internal`, no grant: progress and receipts, never shown.

create table internal.job_file (
  path      text primary key check (length(path) > 0 and path !~ '^/' and path !~ '\.\.'),
  body      text not null,
  saved_at  timestamptz not null default now()
);

comment on table internal.job_file is
  'The latest copy of each file a hosted one-off job writes, so its progress and results outlive the container.';
