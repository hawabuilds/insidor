-- 0014_pairs.sql
--
-- The third read surface: the mints that became a market.
--
-- ★ WHAT THIS SCREEN IS, AND WHY IT IS NOT "NEW PAIRS".
-- A launch is a MINT — a row in public.asset, something that came into existence. A pair
-- is a MARKET — some venue holds a pool deep enough that a price can be read off it.
-- Almost nothing crosses from the first to the second: measured against the mints this
-- store held when this was written, 7 of 192 ever got a pool. That ratio is the most valuable
-- sentence this product can put on a screen, and it is the only thing here that is
-- genuinely a different question from the launches rail.
--
-- ★ AND WE CANNOT DATE A PAIR, WHICH IS WHY THE WORD "NEW" IS NOT IN THIS FILE.
-- public.market_reading is append-only and keyed by (chain, address, taken_at), so it CAN
-- hold the history that would give a pair a first-sighting time. It does not yet: every
-- reading this store holds was taken in a single pass. So "when did this pool open" has no
-- answer here, an ordering by pair-newness cannot be derived, and a screen that claimed one
-- would be inventing the very column it sorted by. The ordering is therefore MINT time,
-- exactly like 0011's, and the surface says so in words rather than implying otherwise with
-- a heading.
--
-- Everything 0009 and 0011 argue about shape is true here and is not repeated: a committed
-- frame, rows whose only readable column is the finished and already-censored payload, and
-- `position` as a column rather than a payload field because where a row sits in a frame is
-- a fact about the frame.
--
-- ★ WHY THIS IS A THIRD PAIR OF TABLES AND NOT MORE ROWS IN public.launch_row.
-- The rows overlap — every pair is also a launch — and that is exactly why they must not
-- share a frame. The two surfaces answer different questions over different windows with
-- different cadences: the rail asks "what has just been minted" over six hours, and this
-- asks "what has ever reached a market" over a fortnight. One frame serving both would
-- have to carry the union and let each surface filter, which is a client deciding what a
-- pair is. That decision is made once, here, by a WHERE clause in the projector.
--
-- It also lets the payloads differ, and they must: a WireLaunch deliberately has no price,
-- and a pair with no price is not a pair.

/* ── the committed frame ──────────────────────────────────────────────────
   Keyed by `feed_id`, like 0011 and for the same two reasons: the two projections cannot
   be joined by accident, and a second pairs feed — another chain, another definition of a
   market — is a row here rather than a schema change. */

create table public.pair_view (
  feed_id      text primary key,
  tick         bigint not null,
  projected_at timestamptz not null default now(),

  /* ★ THE HEAD OF THE SCREEN, AND THE REASON IT RIDES ON THE FRAME.
     Three facts live here rather than in a table of their own: how wide a window the list
     covers, when a mint was last heard on the feed these rows were drawn from, and how many
     mints the window held against how many of them reached a market.

     They are on the FRAME because they are read WITH the frame. A separate
     public.feed_health table would be fetched separately, and a screen could then render
     rows from one projection beside a count from another — two spellings of one thing that
     can disagree, which is the failure 0011 and services/project/src/wire.ts both refuse.
     writePairs writes this row first and unconditionally, inside the same transaction as
     the rows, so a frame and the sentence describing it commit or roll back together.

     jsonb and not a column list, for 0009's reason — "a column list is how a score gets
     requested", and a payload column has nothing to add a word to — plus one that is
     specific to a table the app can already read:

     ★ A NEW COLUMN ON AN ALREADY-GRANTED TABLE IS APP-READABLE THE INSTANT IT EXISTS.
     `grant select on public.pair_view to insidor_app` at the bottom of this file is
     table-level, and Postgres extends a table-level grant to columns added later. So
     0009's "forgetting is the safe direction" property protects new TABLES and does NOT
     protect new COLUMNS. The only safe thing to add to this table is a payload that has
     already been through the censor, which is what this column is. */
  head jsonb not null
);

comment on column public.pair_view.tick is
  'Frame number. Increments by exactly 1 per projection, like board_view.tick and launch_view.tick, and is independent of both.';

comment on column public.pair_view.head is
  'The finished head payload: the window, when a mint was last heard, and the mints-to-markets counts. Already censored. Returned verbatim.';

/* ── the rows of that frame ───────────────────────────────────────────────
   No foreign key to public.asset, for 0011's reason: the payload is a snapshot of the coin
   as it was at this tick, and a screen that half-disappears because an asset row was
   rewritten underneath it is a worse failure than a row naming a key that has moved. */

create table public.pair_row (
  feed_id   text not null references public.pair_view (feed_id) on delete cascade,
  -- '<chain>:<address>', the one storable spelling of an asset.
  asset_key text not null,
  position  int  not null,
  -- The exact WirePair JSON, already censored and already length-bounded.
  payload   jsonb not null,
  primary key (feed_id, asset_key)
);

/* The committed order, exactly like launch_row_order_idx. "Newest mint first" is not a
   query this table answers — it is a decision the projector already made and wrote down. */
create index pair_row_order_idx on public.pair_row (feed_id, position);

comment on column public.pair_row.payload is
  'The finished WirePair JSON. Already censored, already bounded in length. Returned verbatim; nothing reads inside it.';

comment on table public.pair_row is
  'Mints that reached a market, in mint order, as finished wire payloads. Ordering is `position`; nothing re-derives it.';

/* SELECT and nothing else, written by hand for the reason 0009 and 0011 both give: 0001
   deliberately gives insidor_app no default privileges in schema public, so a table added
   by a later migration is invisible to the browser's role until somebody types this line.
   Forgetting is the safe direction. The projector writes these as insidor_service, which
   0001's default privileges already cover, so it needs no line here. */
grant select on public.pair_view, public.pair_row to insidor_app;
