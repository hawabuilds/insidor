-- 0137_post_vector_any_width.sql
--
-- A POST VECTOR AS WIDE AS ITS SPACE: the three post-vector tables' columns hold a vector of any
-- width, so the second post space's 1,536 values are stored as they are beside the 1,024-wide rows.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- 2026-10-25: our own model's words read posts poorly (a benchmark on model-free ground truth kept
-- 26% of same-story pairs where the hosted vendor kept 64%), and the fix is a second words model
-- beside its picture: [words 768, picture 768], 1,536 wide (services/embed/src/space.ts,
-- E5_POST_SPACE). Every vector column was made vector(1024) for the vendor (0069, 0074, 0076), and
-- our first model's 768 values ride in them with a zero tail. 1,536 fits in none of them, and
-- cutting or folding the two halves to 1,024 would change every cosine the bars are measured on.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────
--
-- `embedding` on internal.post_embedding, internal.label_embedding and
-- internal.name_example_embedding loses its width: vector(1024) becomes vector. No row changes and
-- no row is read: the old rows are already valid values of the unconstrained type, so Postgres
-- changes only the catalog — the table keeps its file (same relfilenode) and its indexes, none of
-- which is on the vector. Checked on a throwaway Postgres 17.5 with pgvector 0.8.0 (PGlite),
-- 2026-10-25, running this file against the three tables as 0069/0074/0076 create them: relfilenode
-- of each table and index unchanged (a control change, timestamptz to text, did get a new file),
-- 2,000 1,024-wide rows read back equal, a 1,536-wide row accepted after, and a comparison across
-- the two widths refused by the operator. It still takes each table's exclusive lock for that
-- catalog edit, so the lock wait is bounded: behind a long reader this fails in seconds and is
-- simply run again, rather than queueing every writer behind it.
--
-- Pictures (internal.image_embedding, 0027) and coined pictures (0052) keep vector(1024): the
-- picture space does not change.
--
-- What breaks if changed carelessly: two vectors of different widths cannot be compared (the
-- operator raises an error), and two of one width but different spaces compare as noise. Every read
-- of these tables is pinned to one space (Policy.group.image.postSpace) and a space has one width,
-- so neither happens — a query that joins two of these tables without `space` on both sides is the
-- bug, not this column.

set local lock_timeout = '5s';

alter table internal.post_embedding alter column embedding type vector;
alter table internal.label_embedding alter column embedding type vector;
alter table internal.name_example_embedding alter column embedding type vector;

comment on column internal.post_embedding.embedding is
  'Unit length, as wide as its space: 1,024 (a 768-wide model zero-tailed) or 1,536 (0137). Compare only within one space.';
comment on column internal.label_embedding.embedding is
  'Unit length, as wide as its space: 1,024 (a 768-wide model zero-tailed) or 1,536 (0137). Compare only within one space.';
comment on column internal.name_example_embedding.embedding is
  'Unit length, as wide as its space: 1,024 (a 768-wide model zero-tailed) or 1,536 (0137). Compare only within one space.';
