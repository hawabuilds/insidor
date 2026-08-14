-- 0009_projection.sql
--
-- The read surface. Three tables that hold the FINISHED wire payload, already
-- censored, and nothing else.
--
-- WHY THE APP READS THIS INSTEAD OF JOINING THE BASE TABLES:
-- 0003 states the rule the whole schema is arranged around — a client that can read
-- a censor reason can re-derive the rate we deliberately refused to publish. So
-- public.observation has no grant to insidor_app, and the app therefore cannot build
-- a board by joining story to member to item to observation, because the last hop is
-- closed to it. That is not an obstacle to work around; it is the design. The
-- censoring and the projection happen ONCE, in services/project, running as a role
-- that CAN read the observation series, and what lands here is the answer rather than
-- the ingredients.
--
-- The consequence is the property worth having: the process serving the browser holds
-- a connection that cannot reach a single table containing a judgement. It is not
-- trusted to avoid leaking. It is structurally unable to.
--
-- ★ WHY `payload` IS ONE jsonb COLUMN AND NOT A COLUMN PER FIELD:
-- a column list is how a score gets requested. Every leak in the build this replaces
-- arrived the same way — the reader asked for a column because the column was there,
-- the value came back, and something rendered it. Nobody decided to publish it; the
-- `.select()` string grew one word. A table whose only readable column is the finished
-- payload has nothing to add a word for. There is no `score` to append to the list, no
-- `heat` to sort by, no `policy_hash` to join on, because there is no column list at
-- all — the reader takes the payload verbatim and returns it.
--
-- It also means the read path performs no logic. app/src/shared/api/client.ts already
-- says so out loud: "the read surface is a physical table with no internal column in
-- it, so `select *` is safe and there is no per-call decision to get wrong." A wire
-- shape assembled at read time is a wire shape that can be assembled differently by
-- the next caller. This one is assembled in exactly one place.
--
-- The cost is real and is accepted: the payload is opaque to SQL, so a question like
-- "how many rows carry a coin" cannot be asked of this table. That question is about
-- our machinery and belongs in internal.decisions, which is where it can be asked
-- against the row that actually made the choice.

/* ── the committed frame ──────────────────────────────────────────────────
   One row per board. `tick` is the frame number the client uses to detect a gap:
   app/src/shared/api/live/boardStore.ts drops any frame whose tick is not greater
   than the one it holds, and refetches authoritatively when a tick arrives more than
   one ahead. So the projector must increment it by exactly one per projection —
   a timestamp here, or a random number, silently turns every frame into a gap. */

create table public.board_view (
  view_id      text primary key,
  tick         bigint not null,
  projected_at timestamptz not null default now()
);

comment on column public.board_view.tick is
  'Frame number. Increments by exactly 1 per projection; the client treats a jump as a dropped frame and refetches.';

/* ── the rows of that frame ───────────────────────────────────────────────
   `position` is the committed ordering and the client NEVER sorts. It is a column
   rather than a field inside the payload deliberately: the wire has no `rank` field
   anywhere, so a row cannot carry "our rank" off the board and into a screenshot.
   Position is where the row sits in this frame, which is a fact about the frame; a
   rank is a claim about the story, and the two must not share a spelling.

   There is no foreign key to public.story. The payload is a snapshot of a story as it
   was at this tick, and a board frame that half-disappears because a story was merged
   underneath it is a worse failure than a row pointing at an id that has moved. */

create table public.board_row (
  view_id  text not null references public.board_view (view_id) on delete cascade,
  story_id text not null,
  position int  not null,
  -- The exact BoardRow wire JSON, already censored. Ten keys, no eleventh.
  payload  jsonb not null,
  primary key (view_id, story_id)
);

create index board_row_order_idx on public.board_row (view_id, position);

comment on column public.board_row.payload is
  'The finished BoardRow wire JSON. Already censored. Returned verbatim; nothing reads inside it.';

/* ── the story page ───────────────────────────────────────────────────────
   Keyed by story rather than by view, because a story page outlives its place on the
   board: a link shared while a story was ranked must keep working after it drops off,
   and re-deriving the page from base tables at that moment is exactly the join this
   whole file exists to remove. Projected rows are therefore not deleted when a story
   leaves the board. */

create table public.story_view (
  story_id     text primary key,
  -- The exact Story wire JSON, already censored.
  payload      jsonb not null,
  projected_at timestamptz not null default now()
);

comment on table public.story_view is
  'Finished Story wire payloads. Survives a story leaving the board, so a shared link keeps working.';

/* SELECT and nothing else, written by hand because 0001 deliberately gives insidor_app
   no default privileges — a table added by a later migration is invisible to the app
   until someone types this line, and forgetting is the safe direction.

   The projector writes these as insidor_service, which needs no line here: 0001's
   default privileges in schema public already cover the service and internal roles. */
grant select on public.board_view, public.board_row, public.story_view to insidor_app;
