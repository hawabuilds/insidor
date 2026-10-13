-- 0047_recall_check.sql
--
-- DID DISCOVERY HAVE THE POST BEFORE THE COIN? ONE ROW PER BONDED COIN, ONCE A DAY.
--
-- The gold set says how much discovery WOULD have caught, from a model of the settings. This is
-- the measurement that keeps that model honest from now on: every day, the coins that bonded on
-- the launchpad in the last day whose creator linked a post, and whether that post was already in
-- public.item when the coin launched (tools/recall-check.ts). A model can be wrong in a way that
-- flatters us; a row here cannot, because `first_seen_at` is copied from what we actually held.
--
-- ★ `caught` IS NULL, NEVER FALSE, WHEN THE QUESTION CANNOT BE ASKED. A coin whose creator linked
-- a post on another platform, whose launch time is unknown, or whose post was made after the coin
-- (so it cannot have started it) says nothing about X discovery, and folding it into the rate as a
-- miss would blame the search for a post it could never have run into. Such a row carries its
-- reason (`not_on_x`, `launch_unknown`, `posted_after_launch`) and stays out of the rate.
--
-- ★ A MISS CARRIES ONE REASON, AND `post_unread` IS ONE. The reasons below the first three need
-- the post read again (is it still there, how many approvals, what language); when that read was
-- not made — no key, or spending off — the row says so rather than guessing a cause.
--
-- What breaks if changed carelessly: the reason list is the recall model's (eval/src/recall/
-- model.ts, MISS_REASONS), and eval/src/recall/model.test.ts keeps the two equal. A reason the
-- job can produce and this CHECK refuses fails the day's write after the reads were paid for.
--
-- `internal`, no grant: a measurement of our own pipeline, never shown to a user.

create table internal.recall_check (
  mint             text not null,
  -- The UTC day the job ran for, so a coin seen on two runs is one row per day it was asked.
  day              date not null,
  coin_name        text,
  launched_at      timestamptz,
  bonded_at        timestamptz not null,
  -- The creator's link as written in the coin's metadata, and the post id read out of it.
  post_link        text not null,
  post_platform    text not null check (post_platform in ('x', 'tiktok', 'instagram')),
  post_id          text not null,
  -- Read from the X status id itself, so known even when the post is gone.
  posted_at        timestamptz,
  -- When the post first reached public.item, or null when it never did.
  first_seen_at    timestamptz,
  caught           boolean,
  -- Minutes from first seen to the coin's launch: positive is a lead, negative is late.
  lead_minutes     double precision,
  miss_reason      text check (miss_reason in (
                     'not_on_x', 'launch_unknown', 'posted_after_launch', 'discovery_off',
                     'deleted', 'not_in_search', 'under_floor', 'between_checks', 'post_unread')),
  -- The post as read again by this job, for the reason above; null when it was not read.
  approvals_now    integer,
  checked_at       timestamptz not null,
  primary key (mint, day),
  constraint caught_has_no_reason check (caught is distinct from true or miss_reason is null),
  constraint a_miss_has_a_reason check (caught is distinct from false or miss_reason is not null),
  constraint unaskable_has_a_reason check (caught is not null or miss_reason in ('not_on_x', 'launch_unknown', 'posted_after_launch'))
);

create index recall_check_day on internal.recall_check (day);

comment on table internal.recall_check is
  'Each day''s bonded coins whose creator linked a post, and whether X discovery held that post before the coin launched. caught is null when the question cannot be asked (not on X, launch unknown).';

-- One row per daily run: how many coins bonded, how many could be read, how many linked a post.
-- Kept apart from the per-coin rows so a day on which every metadata read failed reads as
-- "nothing could be checked", not as a day with no bonded coins.
create table internal.recall_check_run (
  day               date primary key,
  ran_at            timestamptz not null,
  bonded            integer not null check (bonded >= 0),
  metadata_read     integer not null check (metadata_read >= 0),
  linked_post       integer not null check (linked_post >= 0),
  -- What the bonded-coin source and the post reads cost this run, as they reported it.
  source_credits    double precision,
  x_usd             double precision not null check (x_usd >= 0)
);

comment on table internal.recall_check_run is
  'One row per daily recall check: coins bonded, metadata documents read, coins that linked a post, and what the run cost.';
