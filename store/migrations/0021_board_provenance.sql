-- 0021_board_provenance.sql
--
-- WHAT KIND OF STORIES A BOARD FRAME IS MADE OF, projected onto the frame itself.
--
-- ★ THE BUG THIS CLOSES, in the owner's words on being shown the board: "everything is
-- just a placeholder". He was right, and nothing on the screen agreed with him.
-- `pnpm db:seed` writes six hand-written stories. 0016 gave every one of them
-- `origin = 'fixture'`, correctly. The projector then published them and the app rendered
-- them under a heading reading **Trending**, with a live pip beside it and a market cap
-- column. A reader had no way to tell that board from one showing the real world.
--
-- That is the one product rule this repository has — a fiction is labelled a fiction or
-- it is not shown — failing on the first surface anybody opens. 0013 and 0016 closed the
-- version of it that matters most (an invented coin can no longer be NAMED under a real
-- moment) and left this one open, because the rows were never the problem. The missing
-- thing was a sentence about the whole frame.
--
-- ★ WHY NOT SIMPLY FILTER FIXTURE STORIES OFF THE BOARD, which is the obvious fix.
-- Because then the board is empty, and an empty board is the state this project has
-- spent five migrations learning to distinguish from a broken one. A newcomer following
-- SETUP.md would run seven commands, see nothing, and have no way to tell "the seed
-- worked and there is deliberately nothing real yet" from "step 4 failed silently". The
-- seeded rows are worth showing; showing them unlabelled is what was wrong.
--
-- ★ WHY A COLUMN ON board_view AND NOT A SEPARATE TABLE. 0015's argument for
-- `launch_view.source`, unchanged and for the same failure: it must ride ON the frame. A
-- separate table would be fetched separately, and the app could then render this frame's
-- rows beside the previous frame's provenance — a board that had just gained its first
-- real story still announcing that everything on it is invented, or worse, the reverse.
-- `writeBoard` writes the view row first and unconditionally, so a frame and its
-- provenance commit or roll back together.
--
-- ★ WHY jsonb AND NOT `seeded_stories integer`. 0015's second reason, which is the one
-- that bites:
--
--   A NEW COLUMN ON AN ALREADY-GRANTED TABLE IS APP-READABLE THE INSTANT IT EXISTS.
--   `grant select on public.board_view to insidor_app` (0009) is table-level, and
--   Postgres extends it to columns added later. So the only safe thing to add to a
--   granted table is a payload that has already been through the censor — which this is:
--   `assertNoInternalVocabulary` runs over the finished WireBoardTick before it is
--   written, exactly as it does for every row.
--
-- ★ WHAT BREAKS IF THIS IS CHANGED CARELESSLY. Give it a default and the notice becomes
-- unreliable in the one direction that matters. A projector that computed no provenance
-- would still commit a frame, and the value it inherited would be whichever of the two
-- answers somebody typed here — and the convenient one to type is `observed`, which is
-- the value that means "there is nothing to warn about". Six fictions would go back to
-- being published as observations, from a column added to stop exactly that. No default:
-- a projector that has not decided fails its INSERT, which is 0013's rule about `origin`
-- and 0007's about `population`, held to here for the same reason.

alter table public.board_view add column provenance jsonb;

/* The backfill states its own ignorance rather than guessing. A frame projected before
   this column existed carries no record of what its stories were, and there is nothing
   left to recover it from — the rows on it may since have been replaced. `seeded` with a
   zero count is the safe direction: it is the branch that makes the app SAY something,
   so a frame we cannot vouch for is announced rather than silently certified as real.

   In practice this row is overwritten by the next projection, seconds later. It exists so
   the NOT NULL below is reachable without a default. */
update public.board_view
   set provenance = '{"kind": "seeded", "seededStories": 0, "totalStories": 0, "connectSourceLabel": "Reddit"}'::jsonb
 where provenance is null;

alter table public.board_view alter column provenance set not null;

comment on column public.board_view.provenance is
  'The finished WireBoardProvenance JSON: whether the stories on this frame were written by the seed, how many, and the free post source to connect. Already censored. Returned verbatim; nothing reads inside it. `{"kind":"observed"}` once a story assembled from real posts reaches the frame, which is how the notice switches itself off without a deploy.';

/* No new grant line. `grant select on public.board_view, public.board_row, public.story_view
   to insidor_app` in 0009 is table-level and already covers this column — see the ★ above,
   which is why it had to be a censored payload rather than typed columns. */
