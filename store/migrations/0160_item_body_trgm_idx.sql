-- 0160_item_body_trgm_idx.sql
--
-- THE POSTS-NAMING-A-COIN SEARCH, READ BY WORD INSTEAD OF POST BY POST (2026-11-01, the evening For
-- You stopped updating at 18:43 and judging fell to a third; the owner: "fix app now fast", no bigger
-- database).
--
-- 0146 indexed this search (store/src/repo/coin-universe.ts `postsNaming`, `posted_at between … and
-- body ilike any …`) by time, so a call read only its window. The window is still every observed
-- post of the last days, about 68,000 bodies: measured that evening, one call took 1.4 s and read
-- 10,224 blocks (80 MB) to return nothing, and at about 15 calls a minute it was the largest reader
-- of the disk by ten times (pg_stat_statements: 3.4 billion blocks since 12 Oct, 442,110 calls).
--
-- A trigram index on the body answers `ilike '%name%'` for a name of three letters or more (the
-- only names the search sends) by reading the few posts that contain it. Same rows, same order:
-- an index changes how they are found, never which.
--
-- HOW IT IS APPLIED: as 0146, built first by hand with CREATE INDEX CONCURRENTLY (the migrator runs
-- each file in a transaction, where CONCURRENTLY cannot run, and a plain build would hold ingest's
-- writes to public.item while it reads the table). This file then finds it built and does nothing.
-- On a fresh database the table is small and the plain build here is instant.
--
-- What breaks if changed carelessly: the partial `where origin = 'observed'` must match the query's
-- own filter, or the planner cannot use the index for it; the operator class lives in the
-- `extensions` schema, where Supabase installs pg_trgm.

create extension if not exists pg_trgm with schema extensions;

create index if not exists item_observed_body_trgm_idx on public.item using gin (body extensions.gin_trgm_ops) where origin = 'observed';
