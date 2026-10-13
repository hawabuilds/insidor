-- 0056_judge_examples_version.sql
--
-- THE JUDGE'S LEARNED EXAMPLES, ONE ROW PER BLOCK EVER BUILT, AND ONE ROW PER SCHEDULED RE-TUNE.
--
-- The feed's post judge reads a block of the owner's own calls after its rules (`examples` in the
-- judge adapter). Twice a day (Policy.learning.retuneAt) tools/retune.ts builds a new block from
-- the owner's taps, missed posts and labels, tests it on posts it does not contain, and applies it
-- only if every gate holds. The live runner reads the latest APPLIED row and nothing else.
--
-- ★ A BLOCK THAT FAILED A GATE IS KEPT, WITH WHY. The row is written whether or not it was applied,
-- so a block that let non-memes through, or shut out gold, is on record with its numbers — the
-- owner reads why the judge did not change, not only that it did not. `applied` is set when the row
-- is written and never changed: a newer applied row supersedes an older one, nothing is updated.
--
-- ★ A RATE NOBODY COULD MEASURE IS NULL, NOT ZERO. With no missed posts held out there is nothing
-- to test "most missed posts pass" on; `missed_pass` is null and `missed_n` is 0. A zero there
-- would read as a block that failed every missed post.
--
-- ★ THE SLOT IS THE CLAIM. `judge_retune` is keyed on the scheduled time (08:00 or 20:00 London as
-- an instant), inserted before any money is spent; a second process, or a restart of the
-- scheduler, finds the slot taken and does nothing. A run that died halfway stays `running` and
-- its slot is not retried — the next slot is twelve hours away and reads the same inputs.
--
-- What breaks if changed carelessly: the runner orders by `applied_at`. A row written applied with
-- no `applied_at` would never be read; the CHECK keeps the two together.
--
-- `internal`, no grant: the system's own tuning, never shown to a user.

create table internal.judge_examples_version (
  version_id          bigint generated always as identity primary key,
  built_at            timestamptz not null,
  -- The text the judge reads after its rules, and its sha256 (the first 16 hex), for the log.
  text                text not null,
  sha                 text not null,
  -- The posts the block is made of: always left out of every test.
  example_ids         text[] not null,
  -- What it learned from, counted: the owner's meme/not taps, missed posts, the labels file's
  -- posts, and name feedback (good and bad names).
  taps_used           integer not null check (taps_used >= 0),
  missed_used         integer not null check (missed_used >= 0),
  labels_used         integer not null check (labels_used >= 0),
  names_used          integer not null check (names_used >= 0),
  -- The newest owner input it read (feedback, missed post or gold addition) and the labels
  -- file's hash: what "nothing new since the last run" is measured against.
  inputs_through      timestamptz,
  labels_sha          text not null,
  -- The three gates, each as passed-of-tested. Null rate means nothing could be tested.
  gold_pass           double precision check (gold_pass between 0 and 1),
  gold_n              integer not null check (gold_n >= 0),
  live_negative_pass  double precision check (live_negative_pass between 0 and 1),
  live_negative_n     integer not null check (live_negative_n >= 0),
  missed_pass         double precision check (missed_pass between 0 and 1),
  missed_n            integer not null check (missed_n >= 0),
  applied             boolean not null,
  applied_at          timestamptz,
  reason_not_applied  text,
  -- A run that measured and recorded but was told not to apply (a dry run).
  dry                 boolean not null,
  -- What the test cost on the learning book.
  cost_usd            double precision not null check (cost_usd >= 0),
  constraint applied_has_a_time check (applied = (applied_at is not null)),
  constraint kept_has_a_reason check (applied or reason_not_applied is not null)
);

create index judge_examples_version_applied on internal.judge_examples_version (applied_at desc) where applied;

comment on table internal.judge_examples_version is
  'Every learned-examples block the re-tune built for the post judge, with its test results; the runner reads the latest applied one.';

create table internal.judge_retune (
  -- The scheduled instant this run is for (Policy.learning.retuneAt in its time zone).
  slot         timestamptz primary key,
  started_at   timestamptz not null,
  ended_at     timestamptz,
  outcome      text not null check (outcome in ('running', 'skipped', 'kept', 'applied', 'dry', 'failed')),
  version_id   bigint references internal.judge_examples_version (version_id),
  -- Why it skipped, why it kept the current block, or the error.
  detail       text,
  cost_usd     double precision check (cost_usd >= 0)
);

comment on table internal.judge_retune is
  'One row per scheduled re-tune of the post judge''s examples: claimed before any spend, then skipped, kept, applied, dry or failed.';
