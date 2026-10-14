-- 0077_name_watch.sql
--
-- THE NAMER'S FIRST DAY ON, WATCHED, AND ITS OFF SWITCH (the owner, 2026-10-14: "watch for wrong
-- coins for the first 24 hours … if wrong coins go up vs before, switch it off and tell me"), and
-- the owner's "Wrong coin" / "No coin" taps as examples of what a post is NOT coined as.
--
-- 1. internal.name_example.rejected — a pair the owner said is wrong for that post: shown to the
--    namer as "not this coin" beside the post's real ones, so a post like it is not guessed the
--    name the owner just rejected. The owner's call on a pair overrides any other source's.
--
-- 2. internal.name_switch — one row, the runtime override of Policy.names.on. Absent: the policy
--    decides. `on = false`: the namer is off whatever the policy says — the runner asks for no
--    guesses and every reader of guesses (Create, coin search, the coin list, the match) reads
--    none. Written by the watch (tools/name-watch.ts) or by hand; read every pass.
--
-- 3. internal.name_watch_state — each feed card's coin as the watch last saw it (one row a post):
--    the first watch run (the baseline, taken before the namer's switch is turned on) and every run
--    after keep it, so "a coin added to a post that had none" is a difference of two readings.
--
-- 4. internal.name_watch_addition — every coin newly shown on a feed post that showed none before
--    (or another coin: `prev_address`),
--    with whether the coin is one of the namer's guesses for the post (`by_guess`) and the owner's
--    later call on it (`verdict`: right / wrong / none). Queryable: the owner's list of additions.
--
-- 5. internal.name_watch_run — each watch run's tally: additions, the owner's calls on them, the
--    wrong share against the day before, and whether it switched the namer off.
--
-- What breaks if changed carelessly: the switch row is a veto, never a "yes": a row with
-- `on = true` does not turn on a namer the policy has off. And the state table must be filled
-- BEFORE the namer is switched on; filled after, every coin the namer added looks as if it had
-- always been there.

alter table internal.name_example add column rejected boolean not null default false;

create table internal.name_switch (
  id          integer primary key default 1 check (id = 1),
  "on"        boolean not null,
  why         text not null,
  changed_at  timestamptz not null default now()
);

create table internal.name_watch_state (
  item_id      text primary key,
  address      text,
  name         text,
  ticker       text,
  kind         text,
  claim_count  integer,
  observed_at  timestamptz not null default now()
);

create table internal.name_watch_addition (
  id          bigserial primary key,
  item_id     text not null,
  address     text not null,
  -- the coin the card showed before, when it showed another (a changed coin); null: it showed none
  prev_address text,
  name        text,
  ticker      text,
  by_guess    boolean not null,
  guesses     jsonb not null default '[]'::jsonb,
  excerpt     text,
  added_at    timestamptz not null default now(),
  verdict     text check (verdict is null or verdict in ('right', 'wrong', 'none')),
  verdict_at  timestamptz
);

create unique index name_watch_addition_pair_idx on internal.name_watch_addition (item_id, address);

create table internal.name_watch_run (
  id             bigserial primary key,
  at             timestamptz not null default now(),
  baseline       boolean not null default false,
  cards          integer not null,
  additions      integer not null,
  by_guess       integer not null,
  labelled       integer not null,
  wrong          integer not null,
  rate_after     double precision,
  rate_before    double precision,
  switched_off   boolean not null default false,
  note           text
);

comment on table internal.name_switch is 'One row: the runtime veto on the namer (Policy.names.on). on = false turns it off everywhere. Never served.';
comment on table internal.name_watch_addition is 'Each coin newly shown on a feed post that showed none, with whether the namer''s guesses named it and the owner''s call on it. Never served.';
