-- 0067_author_picture.sql
--
-- AN ACCOUNT'S PROFILE PICTURE, AS THE SOURCE SHOWED IT WHEN WE LAST READ ONE OF ITS POSTS.
--
-- The post sheet puts the poster's face, name and follower count beside the post (the owner,
-- 2026-10-13). The name and the count already have columns here (`display_name`,
-- `follower_count`); nothing wrote them until the adapters started reading them from the same
-- search results that carry the post. The picture had no column at all.
--
--   picture_url   an https link to the account's picture on the source's own host. A newer read
--                 replaces it; a read that carried none leaves it. Some sources sign these links
--                 and they stop loading after a while: the app then draws the handle's letter,
--                 never a broken image, and the account's next post brings a fresh link.
--
-- `public`, readable by the app role through the table grant in 0002 (a grant on the table
-- covers a column added later). It is a fact the source publishes, the same kind as the handle.
--
-- What breaks if changed carelessly: the store writes this column in its own statement and
-- carries on if it is missing (store/src/repo/authors.ts), so the runner deployed ahead of this
-- migration keeps storing posts. Renaming it silently stops pictures, with no error anywhere.

alter table public.author add column picture_url text;

comment on column public.author.picture_url is
  'The account picture as the source last showed it (https). Null: never read. Shown, never joined on.';
