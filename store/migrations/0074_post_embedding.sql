-- 0074_post_embedding.sql
--
-- EVERY JUDGED POST'S MEANING, KEPT: the vector the runner already pays for when it finds a post's
-- precedents (services/runner work/precedents.ts), stored instead of thrown away, so the projector
-- can tell which feed posts are about the same story as a post the owner confirmed a coin for
-- (services/project story-coins.ts, "Coin for this story").
--
-- One row per post and space, written once when the post is first judged with precedents; a
-- re-judge with the same words and picture writes the same vector again, harmlessly. Same space
-- and same input as internal.label_embedding (0069) — core `embedInput` over the judge's words and
-- the feed's picture — so a feed post and a labelled post are vectors of the same thing and their
-- similarity means something. A post vector is never compared with a picture-only one
-- (internal.image_embedding): the space is part of the key and every comparison joins on it.
--
--   item_id     the post, as the feed names it
--   space       the embedding space (the adapter's post space)
--   embedding   unit length, as the adapter writes it
--
-- No vector index: the projector compares the feed's few hundred posts with the owner's few dozen
-- confirmed ones, brute force. Add one if either side grows to tens of thousands.
--
-- What breaks if changed carelessly: the vector must be the one the precedents compared, built by
-- core `embedInput`; a vector of other words is a different meaning, and the story-coin bar
-- (Policy.postCoin.storyCoin) was measured on these. `internal`, no grant to the app; nothing here
-- is ever served.

create table internal.post_embedding (
  item_id      text not null check (length(item_id) > 0),
  space        text not null check (length(space) > 0),
  embedding    vector(1024) not null,
  embedded_at  timestamptz not null default now(),
  primary key (item_id, space)
);

-- Kept for KEEP_DAYS (store repo post-embeddings.ts, 3) and pruned by the runner's own writes: about
-- 10,000 posts are judged a day at ~4 KB each, and only the feed's one-day window is ever compared.
create index post_embedding_embedded_at_idx on internal.post_embedding (embedded_at);

comment on table internal.post_embedding is
  'Each judged post''s words-and-picture vector (the precedents'' own), kept so the projector can match a feed post to a story the owner confirmed a coin for. Never served.';
