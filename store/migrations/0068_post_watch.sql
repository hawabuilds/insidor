-- 0068_post_watch.sql
--
-- A PERSON WATCHING ONE POST FOR ITS COIN: the post sheet's bell (services/notify).
--
-- The bell on a post means "tell me when a coin is proven to come from this post". A narrative
-- already has its own watch (people.watch, 0044); a post with no narrative had nothing to hang
-- the bell on, so it was not drawn. This is that watch, one row per person and post.
--
--   item_id      the post, as the feed names it (public.item.item_id). No foreign key: a post
--                can be watched from the feed before or after the store prunes anything, and a
--                watch on a post that is gone simply never fires.
--   notified_at  when this person was told about the post's proven coin; null until then. Set
--                once and never cleared, so the alert is sent ONCE per person and post, however
--                often the post's coin line is rewritten afterwards. A post whose coin was
--                already proven when the bell was tapped is marked at once and sends nothing:
--                the sheet already shows that coin.
--
-- Unwatching deletes the row; watching again starts a fresh one.
--
-- What breaks if changed carelessly: the notify loop picks rows `where notified_at is null`; a
-- default on it, or a reset of it, sends the same alert again.

create table people.post_watch (
  user_id      text not null references people.profile(user_id) on delete cascade,
  item_id      text not null,
  created_at   timestamptz not null default now(),
  notified_at  timestamptz,
  primary key (user_id, item_id)
);
create index post_watch_waiting_idx on people.post_watch (item_id) where notified_at is null;

grant select, insert, update, delete on people.post_watch to insidor_people;
