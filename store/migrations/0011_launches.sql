-- 0011_launches.sql
--
-- The second read surface: coins in the order they were minted.
--
-- Same shape and same argument as 0009 — a committed frame, and rows whose only readable
-- column is the finished, already-censored wire payload. Everything 0009 says about why
-- `payload` is one jsonb column rather than a column per field is true here and is not
-- repeated: a column list is how a score gets requested, and a table with no column list
-- has nothing to add a word to.
--
-- ★ WHY THIS IS A SEPARATE PAIR OF TABLES AND NOT MORE ROWS IN public.board_row.
-- Three reasons, and each of them alone would be enough:
--
--   1. A DIFFERENT KEY. A board row is keyed by story; a launch is keyed by ASSET. One
--      story can carry six coins and one coin can appear under no story at all — which is
--      the normal state of a coin four minutes old, and it is precisely the population this
--      surface exists to show. Forcing them into one table would mean a nullable story_id
--      and a primary key that is honest for neither.
--
--   2. A DIFFERENT FRAME. The board's `tick` is the contract the live channel is built on:
--      the client drops a frame whose tick is not greater than the one it holds. Launches
--      are polled today and have no channel. Sharing one tick would make a launches
--      projection look, to the board's client, like a board frame that changed nothing —
--      or worse, would advance the board's tick without new board rows and provoke the
--      refetch loop 0009 warns about.
--
--   3. A DIFFERENT CADENCE. The launches feed wants to run far more often than the board.
--      Two tables means the two can be projected on different schedules without one
--      deciding the other's freshness.
--
-- ★ AND WHAT IS DELIBERATELY NOT HERE: no `minted_at` column, no `market_cap_usd` column,
-- no `symbol`. Ordering was decided by the projector and is stored as `position`; the
-- figures were decided by the projector and are inside the payload. A `minted_at` column
-- here would be a second copy of the mint time, in a table the app role CAN read, which is
-- a copy that can disagree with the one inside the payload and be sorted by independently.
-- 0005 owns mint time. This table owns a frame.

/* ── the committed frame ──────────────────────────────────────────────────
   Keyed by `feed_id` rather than `view_id` so the two projections cannot be joined on a
   shared id by accident, and so a second launches feed (a different chain, a different
   venue) is a row here rather than a schema change. */

create table public.launch_view (
  feed_id      text primary key,
  tick         bigint not null,
  projected_at timestamptz not null default now()
);

comment on column public.launch_view.tick is
  'Frame number. Increments by exactly 1 per projection, like board_view.tick, and is independent of it.';

/* ── the rows of that frame ───────────────────────────────────────────────
   `position` is the committed ordering — newest mint first — and the client NEVER sorts.
   It is a column rather than a payload field for the reason 0009 gives about `rank`: where
   a row sits in this frame is a fact about the frame, and a number travelling inside the
   payload would be a claim the row could carry off the rail and into a screenshot.

   No foreign key to public.asset. The payload is a snapshot of the coin as it was at this
   tick; a rail that half-disappears because an asset row was rewritten underneath it is a
   worse failure than a row naming a key that has moved. */

create table public.launch_row (
  feed_id   text not null references public.launch_view (feed_id) on delete cascade,
  -- '<chain>:<address>', the one storable spelling of an asset. Unique by 0005's constraint,
  -- so a client key made from it is stable across frames.
  asset_key text not null,
  position  int  not null,
  -- The exact WireLaunch JSON, already censored and already length-bounded. Nine keys.
  payload   jsonb not null,
  primary key (feed_id, asset_key)
);

/* "Most recent first" is not a query this table answers — it is a decision the projector
   already made and wrote down. So the index is on the committed order, exactly like
   board_row_order_idx, and there is no index on a time column here because there is no
   time column here. The recency ordering lives in 0005's asset_time_idx, where the mint
   time actually is. */
create index launch_row_order_idx on public.launch_row (feed_id, position);

comment on column public.launch_row.payload is
  'The finished WireLaunch JSON. Already censored, already bounded in length. Returned verbatim; nothing reads inside it.';

comment on table public.launch_row is
  'Coins in the order they were minted, as finished wire payloads. Ordering is `position`; nothing re-derives it.';

/* SELECT and nothing else, written by hand for the reason 0009 gives: 0001 deliberately
   gives insidor_app no default privileges, so a table added by a later migration is
   invisible to the app until someone types this line, and forgetting is the safe
   direction. The projector writes these as insidor_service, which needs no line here. */
grant select on public.launch_view, public.launch_row to insidor_app;
