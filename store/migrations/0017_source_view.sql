-- 0017_source_view.sql
--
-- WHICH OF THE SOURCES WE INGEST FROM ARE ANSWERING — the finished, censored answer, on
-- the one surface the browser's role can read.
--
-- ★ THE BUG THIS CLOSES, AND IT IS 0015's BUG ON A DIFFERENT AXIS. A board fed by three
-- sources and a board fed by one look identical: same layout, same rows, fewer stories.
-- Nothing on the screen distinguishes "the world is quiet" from "two thirds of our inputs
-- are dark", and the second is the state that makes every other number on the page mean
-- something different. It is the same failure the coverage log, the gap rows and the
-- stale-feed banner were each built to prevent, arriving on the last surface that has no
-- defence against it.
--
-- ★ AND IT MUST DISTINGUISH TWO KINDS OF DARK, which is the whole reason this is a payload
-- and not a boolean. A source nobody has turned on is not a fault; a source we are paying
-- for that has stopped answering is. They demand opposite responses — the first is a person
-- editing a config file, the second is somebody being woken up — and collapsing them is how
-- a permanently unconfigured source spends a quarter looking like an intermittently flaky
-- one. `adapters/kit/vendor/src/errors.ts` already makes that argument at the vendor edge;
-- this is the same distinction arriving on a screen.
--
-- ★ WHY IT HAS TO BE PROJECTED AND CANNOT BE FETCHED, measured exactly as 0015 measured it:
--
--     set role insidor_app; select count(*) from internal.stage_runs;
--     ERROR:  permission denied for schema internal
--
-- Whether a source is erroring is a fact about our own machinery, and every table that
-- holds one lives in `internal`, where 0001 never granted the app role so much as USAGE.
-- The app cannot read it and could not even ask whether it may. So the three-way call is
-- made ONCE, in services/project, behind a credential allowed to see the ingredients, and
-- what lands here is the finished sentence.
--
-- ★ WHY A NEW TABLE AND NOT A COLUMN ON public.board_view. Four reasons, and the first is
-- the one that decided it:
--
--   1. IT RESTORES THE SAFE-DIRECTION PROPERTY THAT COLUMNS DO NOT HAVE. 0015 names the
--      hole in its own ★: a new COLUMN on an already-granted table is app-readable the
--      instant it exists, because `grant select on <table>` is table-level and Postgres
--      extends it to columns added later. A new TABLE is invisible until somebody writes
--      the grant at the bottom of this file, so forgetting fails closed. Source health is
--      the payload most likely to grow a field under pressure — an error string, a retry
--      count, a vendor's name, what the call cost — and that is precisely the payload you
--      want standing behind a fresh grant line and its own censor test.
--   2. A DIFFERENT KEY AND A DIFFERENT FRAME. Board rows are keyed by story; this is keyed
--      by source. And 0009's contract is load-bearing: `board_view.tick` must increment by
--      exactly one per projection, because app/src/shared/api/live/boardStore.ts treats a
--      jump as a dropped frame and refetches. Health changes when a credential appears or a
--      vendor starts erroring — on nobody's board schedule — so it would either ride a
--      no-op board frame or advance a tick with no new rows behind it.
--   3. THE INDICATOR IS GLOBAL CHROME. It sits in the nav on every route, including the
--      ones the board frame does not describe at all. A fact about the whole pipeline
--      should not be a field on one screen's frame.
--   4. It is written by its own entrypoint on its own cadence (services/project/src/
--      sources-main.ts), so it cannot take the board's transaction down with it.
--
-- The honest cost, stated so the decision is made with it in view: this does NOT ride the
-- live channel — services/read/src/stream.ts pushes board frames only — so the shell polls
-- it. That is the right trade for a fact that changes on a deploy rather than on a tick.
--
-- ★ WHY jsonb AND NOT A ROW PER SOURCE WITH TYPED COLUMNS. 0009's argument first: a column
-- list is how a score gets requested, and a payload column has nothing to add a word to.
-- Then the shape argument: there are three to five sources, the projector has already
-- decided their ORDER, and a row-per-source table buys per-row patching and pagination that
-- nothing will ever use — while costing a second statement that could return a set of rows
-- describing a different moment from the tick beside them. This is `pair_view.head`'s shape
-- (0014) and not `board_row`'s, for `pair_view.head`'s reason.

create table public.source_view (
  -- One row per surface. 'default' today; a second board with a different set of inputs is
  -- a row here rather than a schema change, exactly as in 0009 and 0011.
  view_id      text primary key,

  -- Frame number, incremented by exactly one per projection. It buys nothing today — there
  -- is no live channel behind this table — and it is an increment rather than a timestamp
  -- so that the day one arrives, a frame number does not have to change meaning. Same
  -- argument as `nextLaunchTick`'s.
  tick         bigint not null,
  projected_at timestamptz not null default now(),

  -- The finished WireSourceHealth[] JSON, in the order the projector decided. NOT NULL and
  -- no default, for the reason 0013 gives about `origin` and 0015 gives about `source`:
  -- omitting it has to be a failed INSERT rather than a habit. A nullable column here would
  -- mean a projector that forgot the health fact still commits a frame, and the nav would
  -- go back to showing nothing above a board with no inputs.
  sources      jsonb not null
);

comment on column public.source_view.tick is
  'Frame number. Increments by exactly 1 per projection, like board_view.tick and launch_view.tick, and is independent of both.';

comment on column public.source_view.sources is
  'The finished WireSourceHealth[] JSON: per source, a display label, the already-made three-way call, and when it was last heard from. Already censored. Returned verbatim; nothing reads inside it.';

comment on table public.source_view is
  'Which ingest sources are answering, as a finished payload. An empty array is a real answer and means we ingest from nothing at all.';

/* SELECT and nothing else, written by hand for the reason 0009, 0011 and 0014 all give:
   0001 deliberately gives insidor_app no default privileges in schema public, so a table
   added by a later migration is invisible to the browser's role until somebody types this
   line. Forgetting is the safe direction — which is the whole reason this fact went into a
   new table instead of onto an existing one.

   The projector writes it as insidor_service, which 0001's default privileges already
   cover, so it needs no line here. */
grant select on public.source_view to insidor_app;
