-- 0013_asset_origin.sql
--
-- WHERE A ROW CAME FROM. One column, not null, no default, ever.
--
-- ★ THE BUG THIS CLOSES, stated as it was found. `public.asset` held 205 rows: 192 mints
-- captured from a live socket and 13 fixtures written by tools/seed.mjs. The seed stamps
-- its fixtures relative to load time, so they were always the newest rows in the table,
-- so the rail headed NEW LAUNCHES — which asks for the newest mints inside a six hour
-- window — returned ELEVEN ROWS OF WHICH ELEVEN WERE INVENTED. The real mints were six
-- days older and outside the window entirely.
--
-- Nothing crashed and nothing was blank. That is what makes it the worst class of bug in
-- this product: plausible, confident, invented data under a heading asserting it was
-- observed. The app has carried a permanent SAMPLE DATA banner over its own fixtures
-- since the first commit for exactly this reason. That discipline had never reached the
-- database, and so a demonstration row and an observed row were the same row to every
-- query in the system.
--
-- ★ WHY `minted_at_source` IS NOT THIS COLUMN AND CANNOT BE MADE INTO IT. 0005's four
-- MINT_TIME_SOURCES answer "where did the TIME come from" — a claim about the pedigree of
-- one field. This answers "how did the ROW get here" — a claim about the row's
-- relationship to reality. The measurement settles it: the seed spans all four values
-- ('vendor_field' on six fixtures, 'chain_rpc' on four, 'issuer_api' on two, 'none' on
-- one) while the socket writes only 'vendor_field'. So 'vendor_field' means "seeded OR
-- observed" and the other three mean "seeded" purely by an accident of which fixtures
-- exist this week.
--
-- ★ AND NOT `venue_id` EITHER, which is the other thing people reach for. Observed rows
-- carry 'solana:pumpfun' (the adapter's `venueId(CHAIN, …)`) and the seed writes a bare
-- 'pumpfun' / 'raydium'. That is the seed spelling a venue id WRONG, not the seed
-- declaring itself. `venue_id` is free text with no CHECK, so nothing enforces the
-- correlation: a seed corrected to write the full spelling erases it silently, and a real
-- second-venue adapter writing 'solana:raydium' produces a genuine row this heuristic
-- calls a fiction. It is one commit away from being wrong in both directions.
--
-- ★ NO DEFAULT. NOT NOW, NOT EVER — the single most important line in this file.
-- `default 'live_stream'` would mean every existing writer keeps compiling, the seed keeps
-- inserting, and the new column silently certifies fictions as observations: the bug
-- reintroduced by the mechanism meant to fix it. With no default, the next `db:seed` run
-- fails loudly on its INSERT until someone types 'fixture'. Same argument as 0001's
-- "forgetting is the safe direction" and 0005's "Absence is loud and cheap".

alter table public.asset add column origin text;

/* ── the backfill ─────────────────────────────────────────────────────────
   ★ A ONE-TIME FORENSIC RECONSTRUCTION, performed 2026-08-21 against a store measured to
   hold exactly 205 rows: 13 written by tools/seed.mjs and 192 captured from the mint
   socket. It is evidence about THESE rows on THIS date. It is NOT a rule, nothing may
   ever infer an origin this way again, and the reason it is safe to do once is that both
   halves are transcriptions of source code rather than inferences from data.

   Everything the two claims below do not reach is labelled 'unrecorded' and is thereby
   excluded from every surface that asserts observation. That is the honest answer and it
   is deliberately NOT the convenient one: folding an unclassifiable row into 'live_stream'
   would be this whole bug rebuilt inside its own fix. */

/* CLAIM 1 — THE FIXTURES, BY NAME.
   These thirteen asset keys are LITERALS in tools/seed.mjs; the seed's own teardown at
   line 1026 deletes by exactly this list, which is the seed remembering its rows in
   JavaScript because the database had nowhere to remember them. Transcribing the list is
   not a guess about which rows look seeded — it is the seed's own answer, read off the
   only place it was ever written down. Verified: this predicate matched 13 of 13. */
update public.asset set origin = 'fixture'
 where asset_key in (
   'solana:4kLmNq7wR2vTbYxEuHgJcZaPsDiOfQnXvMmZbCyVdRt8',
   'solana:Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump',
   'solana:7xKq2mNvB4pLdRtYwEjHnCzAgFsUiOpQvXmZbNcVdRt3',
   'solana:9mPxWq3nT8vKjRbYuEhGcZaFsDiOlQpXvNmZbCxVdRt7',
   'solana:So1PGkNb2mQ7vXcRtYuPaSdFgHjKzXcVbNm1111aaa',
   'solana:So2GaTe9wErTyUPaSdFgHjKzXcVbNm2222bbbcccd',
   'solana:So3HoT7qWeRtYuPaSdFgHjKzXcVbNm3333cccddde',
   'solana:So4ChEf5rTyUiPaSdFgHjKzXcVbNm4444dddeeeff',
   'solana:So5ThE3tYuIoPaSdFgHjKzXcVbNm5555eeefffggg',
   'solana:So6LaDy1yUiOpAsDfGhJkZxCvBnM6666fffggghhh',
   'solana:2nQwErTyUiPaSdFgHjKzXcVbNm1234567890QwEr',
   'solana:5tYuIoPaSdFgHjKzXcVbNm0987654321TyUiOpAs',
   'solana:8jHgFdSaQwErTyUPaSdFgHjKzXcVbNm112233QwEr'
 );

/* CLAIM 2 — THE OBSERVED ROWS, BY THE ONLY WRITER THAT COULD HAVE MADE THEM.
   `venue_id = 'solana:pumpfun'` is the exact string `venueId(CHAIN, 'pumpfun')` produces,
   and that function is reached only through the venue adapter, which is reached only
   through the mint watcher. That watcher has exactly one implemented transport: its
   `poll` path is a NotImplemented (services/chainwatch/src/wiring.ts, createFeed), so no
   row in this store can be a backfill. The two claims are therefore about WHICH CODE
   wrote the row, corroborated from two independent directions — not in the seed's list,
   and spelled the way only the adapter spells it. Verified: 192 of 192, with 0 left over.

   ★ IT IS STILL THE `venue_id` ACCIDENT, and it is only admissible because it is used
   ONCE, on a store whose contents were counted first, alongside a second predicate that
   agrees with it exactly. As a standing rule it would be wrong, which is why the standing
   rule from here on is the column itself. */
update public.asset set origin = 'live_stream'
 where origin is null and venue_id = 'solana:pumpfun';

/* CLAIM 3 — WHAT NEITHER CLAIM REACHED.
   Zero rows on the store this was written against. Not zero in general, and that is the
   point of the value existing: a row nobody can place is a row nobody may present as
   observed. See ASSET_ORIGINS in contracts/src/asset.ts for why this is a historical fact
   rather than a permanent escape hatch — the column has no default, no writer in the
   repository types this string, and every surface asserting observation is an allowlist
   over the other three, so this value costs a row its visibility. */
update public.asset set origin = 'unrecorded' where origin is null;

alter table public.asset alter column origin set not null;

/* The closed list, kept identical to ASSET_ORIGINS in contracts/src/asset.ts by
   store/src/migrations.test.ts. A CHECK that has drifted from its union typechecks
   perfectly and fails at 3am on the first row of the kind nobody wrote a test for. */
alter table public.asset add constraint origin_is_a_known_kind check
  (origin in ('live_stream', 'backfill', 'operator', 'fixture', 'unrecorded'));

comment on column public.asset.origin is
  'What kind of contact with the world produced this row. NOT where the mint time came from — that is minted_at_source, and a seed writes all four of its values. No default: a writer that has not decided fails its INSERT.';

/* ── no index, and that is a decision ─────────────────────────────────────
   The launches query walks 0005's partial `asset_time_idx (chain, minted_at desc)`
   backwards and filters origin as a predicate over what it finds. The tempting index —
   the same one, partial on `origin <> 'fixture'` — would be a FIFTH place the closed list
   is written down, and the one place no test reads. At the size this table is filtered to
   by a six-hour window the predicate is free; when it stops being free the answer is an
   index on `(chain, origin, minted_at desc)`, where the list is a column value rather
   than a literal baked into a WHERE clause that only a reindex can change. */
