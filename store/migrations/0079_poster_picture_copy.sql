-- 0079_poster_picture_copy.sql
--
-- A POSTER'S PICTURE, COPIED INTO OUR OWN STORAGE (the owner, 2026-10-14: "i want to see tiktok
-- poster pfp in fyp aswell").
--
-- `picture_url` (0067) is the source's own link. The short-video source signs its links and they
-- stop loading about a day after the read, so every older card in the infinite scroll lost its
-- poster's face, on every phone. The coin logos solved the same problem by copying the file into
-- the public launch-metadata bucket; the poster pictures now do the same, into `author-pics/`.
--
--   picture_copy     the file name in `author-pics/` (32 hex characters, nothing else). The app
--                    builds the public path from it, as it builds a coin logo's from the address,
--                    so no reply carries the storage vendor's host. Named from the account and
--                    the picture's own path, so a new picture is a new file and a phone never
--                    keeps an old face from its cache. Null: no copy yet; the app uses the link.
--   picture_copy_of  the exact `picture_url` the copier last took up, copied or refused. The
--                    copier works on accounts whose link differs from this, so a link is fetched
--                    once, and a refused one (an HEIC file, an expired link) is tried again only
--                    when a newer read brings a new link.
--
-- `public`, readable by the app role through the table grant in 0002, like `picture_url`. Written
-- only by the copier (services/project/src/poster-pics.ts), on the service credential.
--
-- What breaks if changed carelessly: the read service reads `picture_copy` through `to_jsonb(a)`
-- and the copier stops quietly on a missing column, so both run before this migration. Renaming
-- either column silently stops the copies; the app then falls back to the source's link.

alter table public.author
  add column picture_copy    text,
  add column picture_copy_of text;

comment on column public.author.picture_copy is
  'File name of our copy of the account picture in the public bucket folder author-pics/. Null: no copy; use picture_url.';
comment on column public.author.picture_copy_of is
  'The picture_url the copier last took up (copied or refused); a different picture_url is due a copy.';
