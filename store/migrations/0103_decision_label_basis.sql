-- 0103_decision_label_basis.sql
--
-- WHAT THE LABEL JOB NEEDS FROM EACH ARCHIVED DAY OF THE DECISION LOG, KEPT IN THE DATABASE.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-18: "Before each day of the decision log is archived, copy just the columns
-- the 30-day label job needs into a small table that stays in the database. The label job reads
-- that table." internal.decisions now keeps one day (tools/archive-decisions.ts moves older days
-- to the decision-archive bucket and drops them), and services/label derives its whole work queue
-- from the log: every subject ever decided about, the earliest origin recorded for it, and which
-- stories the resolve stage examined or matched a coin to. With the old days gone, a subject
-- decided about on 12 October simply stopped existing for it, thirty days before its window closed.
--
-- ── WHAT THE TABLES HOLD ─────────────────────────────────────────────────
--
-- internal.decision_label_basis      one row per (day, subject) for the kinds the label job grades
--                                    (item, story, candidate; never pair): the earliest
--                                    subject_origin that day, how many decisions, and the distinct
--                                    resolve-stage verdicts (null when the resolve stage did not
--                                    decide about it that day). That is everything the three label
--                                    reads ask of the log, and about one row in twenty of it.
-- internal.decision_label_basis_day  one row per day whose basis is complete, written after every
--                                    basis row of that day has been written and counted. It is the
--                                    switch: the label job reads a day's basis rows only when this
--                                    row exists, and reads the live partition for that day only
--                                    when it does not. A half-written day is invisible, and a day
--                                    present in both places is read once.
--
-- Per day, not per subject across days: a day's rows are a pure function of that day's partition,
-- so writing a day twice (a retried archive, the backfill run again) writes the same values and
-- never double-counts. Per-subject merging would save a little space and lose that.
--
-- What breaks if changed carelessly: the label job's answers. min(origin_min) over a subject's days
-- must equal min(subject_origin) over its decisions, which is why origin_min is stored to the
-- microsecond and never rounded; a day row written before its basis rows are counted would let the
-- label job read a partial day as the whole of it. Kinds added to the label job must be added here
-- and the days backfilled from the bucket, or the new kind will see only the last day.

create table internal.decision_label_basis (
  day              date not null,
  subject_kind     text not null check (subject_kind in ('item', 'story', 'candidate')),
  subject_id       text not null,
  origin_min       timestamptz,
  decisions        integer not null check (decisions > 0),
  resolve_verdicts text[] check (
    resolve_verdicts is null
    or (cardinality(resolve_verdicts) > 0 and resolve_verdicts <@ array['pass', 'hold', 'drop', 'abstain']::text[])
  ),
  primary key (day, subject_kind, subject_id)
);

-- The two resolve-stage reads (which coin came out of a story, did we ever look) ask only for the
-- rows with a resolve verdict, a few percent of the table.
create index decision_label_basis_resolve_idx
  on internal.decision_label_basis (subject_kind, subject_id)
  where resolve_verdicts is not null;

comment on table internal.decision_label_basis is
  'The label job''s view of each archived day of internal.decisions (0103): per day and subject (item, story, candidate), the earliest subject_origin, the decision count and the resolve-stage verdicts. Read only for days listed in internal.decision_label_basis_day.';

create table internal.decision_label_basis_day (
  day         date primary key,
  log_rows    bigint not null check (log_rows >= 0),
  decisions   bigint not null check (decisions >= 0 and decisions <= log_rows),
  subjects    integer not null check (subjects >= 0),
  source      text not null check (source in ('archive', 'backfill')),
  written_at  timestamptz not null default now()
);

comment on table internal.decision_label_basis_day is
  'Days whose internal.decision_label_basis rows are complete (0103): log_rows is every decision that day, decisions those of the graded kinds, subjects the basis rows. The label job reads a day from the basis only when it is listed here, and from internal.decisions otherwise.';

grant select, insert, update on internal.decision_label_basis, internal.decision_label_basis_day to insidor_internal;
grant select on internal.decision_label_basis, internal.decision_label_basis_day to insidor_service;
