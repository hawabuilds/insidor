-- 0015_feed_source.sql
--
-- WHEN THE FEED BEHIND A FRAME WAS LAST HEARD FROM, projected onto the frame itself.
--
-- ★ THE BUG THIS CLOSES. `internal.mint_coverage` knew, to the second, that nothing had
-- been heard on the mint stream for 141 hours. The launches rail rendered six-day-old
-- coins under a heading saying NEW LAUNCHES, with a lit pip and a pill reading "updated
-- 2s ago", and both of those were TRUE — the poll loop was perfectly healthy over a
-- transport that had been dead for six days. Two independent facts, one of which the
-- screen had no way to say. A dead feed must not look like a quiet one; that is the same
-- failure the coverage log exists to prevent, arriving on a different surface.
--
-- ★ WHY IT HAS TO BE PROJECTED AND CANNOT BE FETCHED. Measured, not assumed:
--
--     set role insidor_app; select count(*) from internal.mint_coverage;
--     ERROR:  permission denied for schema internal
--
--     set role insidor_app; select has_table_privilege('insidor_app','internal.mint_coverage','SELECT');
--     ERROR:  permission denied for schema internal
--
-- The second failure is the sharper proof: the app role cannot even ASK whether it has
-- the privilege, because it has no USAGE on the schema in which to name the table. That
-- is 0001 working exactly as written — "internal: the app is not mentioned. Not revoked
-- — never granted." The projector holds a credential that CAN read it. So the freshness
-- fact travels the same road as every other fact on this surface: computed once, behind
-- a connection allowed to see the ingredients, and committed as a finished answer.
--
-- ★ WHY A COLUMN ON launch_view AND NOT A NEW `feed_health` TABLE. It must ride on the
-- FRAME. A separate table would be fetched separately, and the rail could then render
-- rows from one frame beside a freshness claim from another — the exact "two spellings of
-- one thing that can disagree" that 0011 and the wire both refuse. `writeLaunches` already
-- writes the view row FIRST and unconditionally, so a frame and its provenance-in-time
-- commit or roll back together.
--
-- ★ WHY jsonb AND NOT `last_heard_at timestamptz` + `feed_live boolean`. 0009's argument
-- holds unchanged — a column list is how a score gets requested, and a payload column has
-- nothing to add a word to. But there is a second reason and it is the one that bites:
--
--   A NEW COLUMN ON AN ALREADY-GRANTED TABLE IS APP-READABLE THE INSTANT IT EXISTS.
--   `grant select on public.launch_view to insidor_app` (0011) is table-level, and
--   Postgres extends it to columns added later. So 0009/0011's "forgetting is the safe
--   direction" property protects new TABLES and does NOT protect new COLUMNS: anything
--   added here is exposed by default. Which means the only safe thing to add to a granted
--   table is a payload that has already been through the censor. That is a real gap in an
--   otherwise airtight rule and it is written here rather than discovered later.

alter table public.launch_view add column source jsonb;

/* The backfill states its own ignorance rather than inventing a plausible instant. A view
   row projected before this column existed carries no record of what the feed was doing
   at the time, and there is nothing to recover it from — `projected_at` is when WE ran,
   which is the "backfill the mint time from when we looked" mistake wearing a different
   column name. So the absent form, with the reason the wire already has a word for, and
   `live: false` because a frame that cannot say it was live must not claim to have been.

   In practice this row is overwritten by the next projection, seconds later. It exists so
   that the NOT NULL below is reachable without a default. */
update public.launch_view
   set source = '{"lastHeardAt": {"at": null, "why": "not_read_yet"}, "live": false}'::jsonb
 where source is null;

/* NOT NULL and no default, for the reason 0013 gives about `origin` and 0007 gives about
   `population`: omitting it has to be a failed INSERT rather than a habit. A nullable
   column here would mean a projector that forgot the freshness fact still commits a frame,
   and the rail would go back to rendering old mints with nothing above them. */
alter table public.launch_view alter column source set not null;

comment on column public.launch_view.source is
  'The finished WireFeedSource JSON: when this feed was last heard from, and whether it is believed live. Already censored. Returned verbatim; nothing reads inside it.';

/* No new grant line. `grant select on public.launch_view, public.launch_row to insidor_app`
   in 0011 is table-level and already covers this column — see the ★ above, which is why
   the column had to be a censored payload rather than two typed columns. */
