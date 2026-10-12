-- 0031_open_pointers.sql
--
-- A QUOTE MAY POINT AT A POST WE HAVE NEVER STORED.
--
-- `item.reproduction_of` and `item.rebroadcast_of` were foreign keys to public.item. But the
-- catch-all search keeps quotes, and the post a quote points at is usually one we never
-- saw: it was older than the window, or under the floor. With the key in place, storing that
-- quote failed — and the arrivals write stops at the first failure, so the rest of its page
-- was lost with it.
--
-- The pointer is a fact the source told us, true whether or not we hold the other end, and
-- it is exactly what the backfill follows to find where a story started. So it is kept as
-- written and the key is dropped. Anything that joins on it already has to allow a miss:
-- GROUP's lineage lookup (`storiesOfItems`) returns nothing for a post we do not have.
--
-- What breaks if changed carelessly: putting the key back, or nulling the pointer when the
-- target is unknown, loses every quote chain at the moment it is first seen.

alter table public.item drop constraint item_reproduction_of_fkey;
alter table public.item drop constraint item_rebroadcast_of_fkey;

comment on column public.item.reproduction_of is
  'The post this one quotes, as the source named it. May be a post we have never stored.';
comment on column public.item.rebroadcast_of is
  'The post this one re-shares, as the source named it. May be a post we have never stored.';
