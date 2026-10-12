-- 0027_image_embedding.sql
--
-- ONE VECTOR PER IMAGE, ONCE: what GROUP compares an edited copy against.
--
-- The free image carrier (a perceptual hash) only finds near-copies, and nothing computes it
-- yet. Memes are cropped, captioned, filtered, re-backgrounded and redrawn as fan art, and a
-- hash misses every one of those. A multimodal embedding of each post's picture (and later
-- each coin's) lands an edited copy near its original; GROUP reads the best similarity
-- between a new post's picture and a story's pictures as evidence (core/src/group/match.ts).
--
-- Keyed by subject AND uri AND space, so an image is embedded once per space and never
-- again, and two spaces never meet in one comparison. 1,024 dimensions is the one space in
-- use; a second space with a different width gets its own table rather than a wider column.
--
-- `internal`, no grant: a vector is our reasoning about a picture, not a fact about it.

create table internal.image_embedding (
  subject_kind text not null check (subject_kind in ('item', 'asset')),
  subject_id   text not null,
  uri          text not null check (length(uri) > 0),
  space        text not null check (length(space) > 0),
  embedding    vector(1024) not null,
  embedded_at  timestamptz not null,
  primary key (subject_kind, subject_id, uri, space)
);

comment on table internal.image_embedding is
  'One embedding per post or coin image, per space, written once. Read by GROUP for image similarity; never served.';
