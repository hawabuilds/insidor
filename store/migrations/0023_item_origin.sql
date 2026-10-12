-- 0023_item_origin.sql
--
-- WHERE A POST CAME FROM. One column, not null, no default, ever — 0016's shape, for posts.
--
-- ★ WHY NOW. Until GROUP wrote memberships, every story was written whole by tools/seed.mjs
-- and 0016 could label it at the INSERT. Once GROUP seeds stories from posts, the story's
-- origin has to come from somewhere, and the only honest place is the posts it was built
-- from. public.item had nothing to say: a seeded post and a post read from X were the same
-- row shape, told apart only by an id prefix that nothing promises to keep.
--
-- ★ NO DEFAULT, for 0016's reason. `default 'observed'` would let the next tool that writes
-- a post inherit a claim that a person posted it. With no default the writer fails loudly
-- on its INSERT until someone types the value.

alter table public.item add column origin text;

/* ── the backfill ─────────────────────────────────────────────────────────
   ★ A ONE-TIME RECONSTRUCTION, written 2026-10-12. Two writers have ever inserted into
   public.item: tools/seed.mjs and PgItemRepo.upsert. It is evidence about those two
   writers, not a rule, and nothing may infer a post's origin this way again. */

/* CLAIM 1 — THE SEEDED POSTS, BY NAME. These ids are literals in tools/seed.mjs (the `id:`
   field of every member in STORIES), and the seed's teardown deletes by exactly this list.
   Transcribing it is the seed's own answer, not a guess about which rows look seeded. */
update public.item set origin = 'fixture'
 where item_id in (
   'it_pigeon_1', 'it_pigeon_2', 'it_pigeon_3',
   'it_ferry_1', 'it_ferry_2', 'it_ferry_3', 'it_ferry_4',
   'it_chill_1', 'it_chill_2', 'it_chill_3', 'it_chill_4',
   'it_soup_1', 'it_soup_2', 'it_soup_3', 'it_soup_4',
   'it_dance_1', 'it_dance_2', 'it_dance_3',
   'it_roof_1', 'it_roof_2', 'it_roof_3'
 );

/* CLAIM 2 — EVERYTHING ELSE WAS WRITTEN BY PgItemRepo.upsert, whose only callers are the
   runner's ingest loops, which hand it what a platform adapter returned. That is a claim
   about code, not data: no other INSERT into this table exists in the repository. */
update public.item set origin = 'observed' where origin is null;

alter table public.item alter column origin set not null;

/* The closed list, kept identical to ITEM_ORIGINS in contracts/src/vocabulary.ts by
   store/src/migrations.test.ts. */
alter table public.item add constraint item_origin_is_a_known_kind check
  (origin in ('observed', 'fixture'));

comment on column public.item.origin is
  'Whether a person posted this (observed: read from a source or replayed from a recording of one) or a tool wrote it (fixture). A story seeded by GROUP takes its origin from this. No default: a writer that has not decided fails its INSERT.';
