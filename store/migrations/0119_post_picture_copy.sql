-- 0119_post_picture_copy.sql
--
-- A SHOWN POST'S PICTURE, COPIED INTO OUR OWN STORAGE, so a card's picture keeps loading after the
-- source's signed link has expired (the owner, 2026-10-21: previews must never go blank).
--
-- The short-video source signs its cover links (`x-expires`, about a day): on 2026-10-21, 297 of
-- the 311 TikTok posts on For You, Popular and the scroll had a cover that no longer loaded. The
-- poster faces (0079) and the coin logos already live in the public launch-metadata bucket; the
-- post pictures now do too, in `post-pics/` (the list copy) and `post-pics/sheet/` (the sheet's).
--
-- One row per PICTURE, not per post: keyed by the link without its query string, which is the
-- signature and changes on every read. The same picture under a fresh signature is the same row,
-- and a picture two posts share (a repost, a narrative's thumbnail taken from a member) is copied
-- once. The read service finds a card's copy by the path of the link the card already carries, so
-- the projected payloads do not change.
--
--   link_path   the source's link without `?…` or `#…`
--   file        our copy's name, 32 hex characters (nothing else: the app builds the path from it).
--               Null: not copied — refused, expired before it was reached, or not tried yet
--   tried_link  the exact link last taken up, copied or refused; a refused picture is tried again
--               when a newer read brings a different link that still loads, or after
--               `postPictures.retryAfterMs`
--   tried_at    when it was last taken up
--   copied_at   when the copy was written; the per-day cap counts these
--
-- Nothing else about the post is stored here: no id, no author, no words.
--
-- `public`, read by the app role (the read service looks a card's copy up by path). Written only
-- by the copier (services/project/src/post-pics.ts), on the service credential.
--
-- What breaks if changed carelessly: `file`'s shape. The app takes a name only as 32 hex
-- characters (mobile shared/post-pic.ts) and the storage adapter refuses any other
-- (adapters/storage/supabase/src/post-pic.ts). The read service and the copier both treat a
-- missing table as "no copies yet", so code deployed before this migration behaves as before.

create table public.post_picture (
  link_path   text primary key check (link_path like 'https://%'),
  file        text check (file is null or file ~ '^[0-9a-f]{32}$'),
  tried_link  text not null check (tried_link like 'https://%'),
  tried_at    timestamptz not null default now(),
  copied_at   timestamptz
);

create index post_picture_copied_at_idx on public.post_picture (copied_at) where copied_at is not null;

comment on table public.post_picture is
  'Our copy of a shown post''s picture in the public bucket (post-pics/<file>, post-pics/sheet/<file>), keyed by the source link without its signature. file null: not copied.';

/* 0073's rule for every table in `public`: row security on, our four roles let through. */
alter table public.post_picture enable row level security;
create policy insidor_roles on public.post_picture for all
  to insidor_app, insidor_people, insidor_service, insidor_internal using (true) with check (true);

/* The service role writes through 0001's default privileges; the app role reads by this grant alone. */
grant select on public.post_picture to insidor_app;
