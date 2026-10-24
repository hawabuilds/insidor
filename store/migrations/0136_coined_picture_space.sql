-- 0136_coined_picture_space.sql
--
-- A COINED PICTURE ONCE PER SPACE, not once in all: the picture boost's table keyed as every other
-- vector table already is.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- 2026-10-24: the hosted embedding vendor refused every call (its account went negative) and the
-- owner approved our own model on our own machine (services/embed). Its vectors live in a different
-- space; they never compare with the vendor's (contracts/src/ports/embed.ts). Every vector table
-- keys its rows on `space` — image_embedding (0027), label_embedding (0069), post_embedding (0074),
-- name_example_embedding (0076) — so the new model's vectors are written BESIDE the old ones and the
-- switch is a policy edit that can be undone. coined_picture (0052) alone was keyed on the address:
-- a picture could be held in one space only, so re-embedding its 29 rows for the new model would
-- have meant deleting the vendor's, and switching back would have meant paying for them again.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────
--
-- The primary key becomes (uri, space). No row changes. The writer (store coined-pictures.ts) now
-- inserts with a bare `on conflict do nothing`, which holds under either key, so the code may deploy
-- before or after this is applied. The readers already filter on one space (the projector's picture
-- boost reads Policy.group.image.space, services/project rising.ts; the For You fit, score-model.ts).
--
-- What breaks if changed carelessly: dropping `space` from the key again makes the second space's
-- insert a silent no-op — the boost would find no coined picture in the new space and simply never
-- fire, which looks exactly like "no post resembles a coined one".

alter table internal.coined_picture drop constraint coined_picture_pkey;
alter table internal.coined_picture add primary key (uri, space);

comment on table internal.coined_picture is
  'Pictures of posts that were coined, embedded once per space; the projector''s picture boost compares a post''s picture to these, in the policy''s space (0136).';
