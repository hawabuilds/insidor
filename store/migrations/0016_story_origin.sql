-- 0016_story_origin.sql
--
-- WHERE A STORY CAME FROM. One column, not null, no default, ever.
--
-- ★ THE BUG THIS CLOSES, stated as it was found. 0013 gave public.asset an origin and
-- every surface asserting observation an ALLOWLIST over it, which was right: the launches
-- rail stopped serving thirteen invented coins under a heading that said NEW LAUNCHES.
--
-- The same allowlist was then applied to the story↔coin candidate retrieval, which is a
-- different question wearing the same predicate. A story had no origin of its own, so the
-- retrieval could only ask "is this coin observed" — never "is this coin compatible with
-- THIS story" — and the six seeded stories lost the six seeded coins they exist to
-- demonstrate. Measured on this store, before and after that change:
--
--     st_pigeon    none                 none      (correct: nothing was ever minted for it)
--     st_soup      unsure, 6 claims     unsure, 3 claims
--     st_rooftop   one   (SLIDE)        none   ←  wrong
--     st_chillguy  several (3 coins)    none   ←  wrong
--     st_ferry     one   (DOCK)         none   ←  wrong
--     st_dance     several (2 coins)    none   ←  wrong
--
-- ★ AND `none` IS THE DANGEROUS DIRECTION, which is why this is a migration and not a
-- cosmetic repair. `none` is the branch that puts CREATE on the row — the product telling
-- a user to make a coin for a story that already has three. services/project/src/coins.ts
-- has ranked that failure as materially worse than uselessness since the candidate rule
-- was written, and it was live on four rows out of six.
--
-- ★ WHY A COLUMN AND NOT A DERIVATION. The tempting shape is "a story is seeded if all its
-- members are seeded", and public.item has no origin either — so that rule would have to
-- reach for the same accidents 0013 rejected for the asset column: an id prefix, a source
-- name, a created_at that happens to be recent. A story's origin is known at the instant
-- of the INSERT by the code performing it, exactly like an asset's, and a not-null column
-- with no default is the only shape a writer cannot forget to answer.
--
-- ★ NO DEFAULT, for 0013's reason and one more. `default 'observed'` would mean the next
-- tool that writes a story inherits a claim that its rows came from the world, and the one
-- rule that reads this column would then hand that tool's fictions to a real story's row.
-- With no default the writer fails loudly on its INSERT until someone types the value.

alter table public.story add column origin text;

/* ── the backfill ─────────────────────────────────────────────────────────
   ★ A ONE-TIME FORENSIC RECONSTRUCTION, performed 2026-08-20 against a store measured to
   hold exactly six rows in public.story, all six written by tools/seed.mjs. It is evidence
   about THESE rows on THIS date, it is not a rule, and nothing may ever infer a story's
   origin this way again. It is safe to do once because CLAIM 1 is a transcription of
   source code rather than an inference from data. */

/* CLAIM 1 — THE SEEDED STORIES, BY NAME.
   These six ids are LITERALS in tools/seed.mjs (the `id:` field of each entry in STORIES),
   and the seed's own teardown deletes by exactly this list before re-inserting — which is
   the seed remembering its rows in JavaScript because the database had nowhere to remember
   them. Transcribing the list is not a guess about which rows look seeded; it is the
   seed's own answer, read off the only place it was ever written down.
   Verified: this predicate matched 6 of 6. */
update public.story set origin = 'fixture'
 where story_id in (
   'st_pigeon',
   'st_ferry',
   'st_chillguy',
   'st_soup',
   'st_dance',
   'st_rooftop'
 );

/* CLAIM 2 — WHAT CLAIM 1 DID NOT REACH IS CALLED 'observed', AND THAT IS THE OPPOSITE
   SHAPE FROM 0013's THIRD CLAIM ON PURPOSE. There, an unplaceable ASSET became
   `unrecorded` and thereby vanished from every surface asserting observation, because for
   an asset the conservative answer is the one that costs the row its visibility.

   Here the conservative answer is the other value. A story's origin is read in exactly one
   place — the allowlist the candidate retrieval derives from it — and 'observed' is the
   NARROW derivation: an observed story may see observed coins and nothing else, ever. So a
   row this backfill cannot place is given the label that lets it see the least, and the
   failure mode of guessing wrong is a demonstration row that shows no coin. Guessing the
   other way would let a row nobody can place name an invented coin, which is the bug.

   It is also self-repairing where it matters: db:seed deletes and re-inserts its six
   stories with 'fixture' written out, so a seeded row mislabelled here is corrected by the
   next seed run rather than needing a second migration.
   Verified: this predicate matched 0 rows on the store it was written against. */
update public.story set origin = 'observed' where origin is null;

alter table public.story alter column origin set not null;

/* The closed list, kept identical to STORY_ORIGINS in contracts/src/story.ts by
   store/src/migrations.test.ts. Two values and not ASSET_ORIGINS' five: those name kinds
   of transport, and nothing pushes a story at us or fetches one from a vendor. */
alter table public.story add constraint story_origin_is_a_known_kind check
  (origin in ('observed', 'fixture'));

comment on column public.story.origin is
  'What kind of contact with the world produced this row: assembled from observed items, or written by a seed. Read by the coin-candidate retrieval to decide which asset origins this story may be compared against — observed coins are visible to every story, invented ones only to a fixture story. No default: a writer that has not decided fails its INSERT.';

/* ── no index, and that is a decision ─────────────────────────────────────
   Nothing filters stories BY origin. The column is read off the six-or-so rows a frame
   already selected through story_open_idx and turned into a bound parameter for the coin
   query, so it is a projection column and never a predicate. An index here would be a
   fourth place the closed list is written down and the one place no test reads. */
