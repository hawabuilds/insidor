-- 0069_label_embedding.sql
--
-- EVERY POST THE OWNER HAS LABELLED, EMBEDDED ONCE (its words and picture together), so the feed's
-- judge can be shown the labelled posts closest to each post it is asked about, and a post very
-- close to one the owner called "not a meme" can be held (Policy.judge.precedents).
--
-- One row per labelled post and space. The label sources, highest first when two disagree about
-- one post: the owner's newest tap ('tap'), gold — the gold sheets' origin posts and the owner's
-- hand-gold list ('gold'), coined posts — a gold addition or "this is the coin" ('coined'), the
-- owner's missed posts ('missed'), the hand-labelled live set ('labels'). The runner keeps the
-- rows its database sources feed current every pass (new taps embedded, a flipped tap relabelled
-- without a new vector); tools/label-embeddings.ts writes the rest from the committed files.
--
--   item_id     the post, as the feed names it. No foreign key: a gold-sheet post is not one we
--               hold.
--   label       'meme' or 'not': what the judge is shown beside the words.
--   label_kind  where the label came from (the list above): a higher one replaces a lower one.
--   text        the words embedded and shown, '' for a post with none.
--   why         the owner's reason, or what the label came from; null when nothing was said.
--   picture     the picture embedded with the words; null for a post without one, or whose
--               picture could not be read (then the words alone were embedded).
--   space       the embedding space; a post vector is never compared with a picture-only one.
--
-- No vector index: a few hundred rows are compared in the runner, brute force, faster than a
-- round trip to an index would be. Add one if this ever holds tens of thousands.
--
-- What breaks if changed carelessly: the vector must be written already normalised (the embedding
-- adapter does it), or every similarity read from it, and the hold bar, means something else.
-- `internal`, no grant to the app.

create table internal.label_embedding (
  item_id     text not null check (length(item_id) > 0),
  space       text not null check (length(space) > 0),
  label       text not null check (label in ('meme', 'not')),
  label_kind  text not null check (label_kind in ('tap', 'gold', 'coined', 'missed', 'labels')),
  text        text not null,
  why         text,
  picture     text,
  embedding   vector(1024) not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (item_id, space)
);

comment on table internal.label_embedding is
  'The owner''s labelled posts, each embedded once (words and picture together): the judge''s precedents and the not-a-meme hold.';
