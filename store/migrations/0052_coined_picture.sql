-- 0052_coined_picture.sql
--
-- PICTURES OF POSTS PEOPLE ACTUALLY MADE COINS ABOUT, embedded once, for the feed's picture boost.
--
-- The per-post judge sometimes turns a coinable picture down unsurely. When a post's picture is
-- close to one of these, the projector lets an UNSURE "no" through (core's postScoreReason,
-- policy `rising.boostMinSimilarity` / `boostMaxNoConfidence`). The similarity is read in the
-- projection's own query and never leaves it: no number reaches a screen.
--
-- Filled by tools/coined-pictures.ts from the gold set's origin posts (the owner's backtest
-- sheets), one row per picture, keyed by its uri so a picture shared by two coins is held once.
-- `space` names the embedding space, as internal.image_embedding does: two spaces never compare.
--
-- `internal`, no grant to the app.

create table internal.coined_picture (
  uri          text primary key check (length(uri) > 0),
  coin_ref     text not null check (length(coin_ref) > 0),
  space        text not null check (length(space) > 0),
  embedding    vector(1024) not null,
  embedded_at  timestamptz not null default now()
);

comment on table internal.coined_picture is
  'Pictures of posts that were coined, embedded once; the projector''s picture boost compares a post''s picture to these.';
