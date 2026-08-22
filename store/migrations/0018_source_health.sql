-- 0018_source_health.sql
--
-- WHETHER EACH SOURCE WE INGEST FROM IS ANSWERING — the ingredients, in the schema the
-- app has never been taught the name of.
--
-- 0017 added `public.source_view`, which is the finished, censored sentence a browser
-- reads. This is what that sentence is computed FROM. The split is the same one 0015
-- made for the mint feed and it is not ceremony: the facts below name environment
-- variables and quote vendor error messages, and both are text about our own machinery.
-- `internal` is where 0001 never granted the app role so much as USAGE, so the raw
-- material cannot reach a screen by accident — only through a projector that decides
-- what, if anything, of it may be said out loud.
--
-- ★ WHY THIS TABLE HAS TO EXIST AT ALL, RATHER THAN THE PROJECTOR WORKING IT OUT.
-- The projector holds a database URL and nothing else. Two of the three facts below are
-- invisible to it by construction:
--
--   · WHETHER A CREDENTIAL WAS SUPPLIED is knowable only where the credential lives.
--     Reading platform environment variables in the projector would answer a question
--     about the PROJECTOR's environment and publish it as a fact about the ingest loop's
--     — two different processes and, on any real deploy, two different environments. So
--     the process holding the environment writes it down, once, and this side reads it.
--   · WHETHER CALLS ARE WORKING is knowable only where the calls are made.
--
-- ★ WHY IT IS CURRENT STATE AND NOT AN APPEND-ONLY SERIES, which is the opposite of
-- almost every other table here. The series already exists: `internal.stage_runs` holds
-- one row per run forever, and that is where "how often did this fail in March" is
-- answered. What was missing is the current POSITION — one row per source, overwritten —
-- and a second append-only table keyed by source would be a reading series nobody
-- differences, growing a row per call for a question that is only ever asked about now.
-- So no `forbid_mutation` trigger here, deliberately, and that absence is a decision
-- rather than an omission.
--
-- ★ THE THREE FACTS HAVE THREE OWNERS AND THE COLUMNS ARE SPLIT SO ONE CANNOT CLOBBER
-- ANOTHER. `configuration` is written by the process holding the environment;
-- `last_success_at` and the failure columns are written by whoever made the call. A
-- whole-row upsert would let any one writer overwrite the others, and the direction it
-- would overwrite in is always the same: toward the state that looks like nothing is
-- wrong. A source erroring must never be able to rewrite itself as unconfigured, which
-- would turn every outage into "nobody turned this on".

create table internal.source_health (
  -- The source id, as `contracts/src/ids.ts` mints it. Free text and NOT constrained to
  -- a list, for `stage_runs.stage`'s reason: a source added in code must not be a schema
  -- change. A value read back is checked against the registry on the way out instead.
  source               text primary key,

  -- ★ THREE VALUES AND NOT A BOOLEAN, and the third is the one that is easy to lose.
  --   dormant        nothing was supplied. NOT A FAULT — nobody turned it on.
  --   configured     everything was supplied.
  --   misconfigured  SOME of it was supplied, or a constructor refused what was. A
  --                  FAULT, and deliberately not the same value as dormant: it is the
  --                  single most likely way a source somebody believes is running is
  --                  silently not, and recording it as `dormant` would agree with them.
  configuration        text not null check (configuration in ('dormant', 'configured', 'misconfigured')),

  -- Which variables are missing, or what the constructor said. Operator-facing, names
  -- environment variables, and is the whole reason this table is in `internal`.
  configuration_detail text,

  -- Since when the source has been in THIS configuration — not when we last looked.
  -- Moved only when `configuration` itself changes, so "off since Tuesday" is answerable.
  configured_at        timestamptz not null,

  -- ★ LAST SUCCESS, NOT LAST ATTEMPT. A source erroring every sixty seconds has a very
  -- recent last attempt and has told us nothing for an hour. This is the same choice
  -- `stage_runs_recent_idx` makes and W1 in the watchdog keys on, and getting it wrong
  -- is how a stage that fails constantly reads as busy.
  last_success_at      timestamptz,

  last_failure_at      timestamptz,
  -- The vendor's own message, kept whole and never parsed. It is evidence, not a code.
  last_failure_reason  text,

  -- ★ RESET TO ZERO BY A SUCCESS, so a non-zero value always describes failures that
  -- came AFTER the last thing that worked. That property is what lets one threshold in
  -- Policy mean the same thing on every source; a lifetime total could not.
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),

  updated_at           timestamptz not null default now(),

  -- A failure with no reason is a row nobody can act on, and the reason is the only part
  -- of a failure that distinguishes "the key is wrong" from "the vendor is down".
  constraint failure_says_why
    check ((last_failure_at is null) = (last_failure_reason is null)),

  -- A misconfiguration that does not say what is wrong is indistinguishable from a
  -- dormant source to anybody reading the table, which is the exact collapse this whole
  -- migration exists to prevent.
  constraint misconfiguration_says_what
    check (configuration <> 'misconfigured' or configuration_detail is not null)
);

comment on table internal.source_health is
  'Per-source operational state: what configuration said, and what the calls did. Current position, not a series — the series is internal.stage_runs. Read by services/project to compute public.source_view.';

comment on column internal.source_health.configuration is
  'dormant = nothing supplied, NOT a fault. misconfigured = supplied wrong, a fault. Collapsing the two is the bug this column exists to prevent.';

comment on column internal.source_health.last_success_at is
  'When a call to this source last SUCCEEDED. Never "when we last tried" — a source erroring every minute has a very recent last try.';

/* No grant line, and the omission is the point: `internal` is a schema the app role has
   no USAGE on, so there is no line here that could be written to expose this by accident.
   0001's default privileges already give insidor_service SELECT and insidor_internal
   SELECT/INSERT/UPDATE, which covers the projector reading it and the runner writing it. */
