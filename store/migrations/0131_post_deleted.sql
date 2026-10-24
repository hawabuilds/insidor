-- 0131_post_deleted.sql
--
-- A POST ITS SOURCE NO LONGER SHOWS, AND THE ONES WE KNOW WERE DELETED.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-24: "if the post was deleted i want an indication that it was deleted on the
-- post card on the feed". The card keeps what we stored (its words, its picture, its views as last
-- read); what it was missing is the fact that the post is gone, so a person does not tap through to
-- a page that is not there.
--
-- ── WHERE THE FACT COMES FROM: READS WE ALREADY MAKE, AND NOTHING ELSE ──
--
-- The readings loop and TRACK re-read posts by id (services/runner work/readings.ts, stages.ts). A
-- source that declares `leftOutIsGone` (contracts ports/platform.ts; X does) answers such a call or
-- throws; an id it leaves out of an ANSWER is a post it shows nobody now. No new call is made for
-- this and no post is read more often for it.
--
-- ★ LEFT OUT IS NOT YET DELETED, AND THE TWO ARE KEPT IN DIFFERENT PLACES. X leaves a post out the
-- same way whether the author deleted it or the account went private or was suspended, with no
-- reason given. Those are different facts about the world, and only the first is "deleted". So:
--
--   internal.post_unreturned   our own record of the answered re-reads that left a post out since it
--                              was last read: when the first did (`first_at`), the newest (`last_at`)
--                              and how many (`misses`). Our machinery, not a fact for a screen, so it
--                              is internal and the app role never sees it. Deleted (by the runner,
--                              hence the grant below) the moment any later read returns the post.
--   public.item.deleted_at     set only when (services/runner work/gone-posts.ts `goneVerdict`) at
--                              least two answered re-reads left it out AND the same account was seen
--                              publicly after the first of them — another of its posts came back in a
--                              re-read, or a search or lookup returned the account (public.author
--                              `last_seen_at`). An account we can still read is neither private nor
--                              suspended, so its post is the thing that is gone. It is set to
--                              `first_at`: the post was gone by then. Without that proof nothing is
--                              set and the card says nothing — "we cannot tell" is never shown as
--                              "deleted". Cleared again if a later read returns the post.
--
-- The app role reads `deleted_at` through its existing select on public.item (a fact a person could
-- check on the source); the projector puts it on the post's card (services/project rising.ts).
--
-- What breaks if changed carelessly: setting `deleted_at` on one miss, or without the account check,
-- would mark every post of a suspended or private account deleted, and a one-off short answer as a
-- deletion. Granting the app role anything on post_unreturned puts our read record on a screen.

create table internal.post_unreturned (
  item_id   text primary key references public.item (item_id) on delete cascade,
  first_at  timestamptz not null,
  last_at   timestamptz not null,
  misses    integer not null default 1 check (misses >= 1),
  check (last_at >= first_at)
);

comment on table internal.post_unreturned is
  'Answered re-reads that left a post out since it was last read (0131): first, newest, how many. Removed when a read returns the post.';

/* The runner removes a row once the post is read again; 0001's defaults give it no delete. */
grant delete on internal.post_unreturned to insidor_internal;

alter table public.item add column deleted_at timestamptz;

comment on column public.item.deleted_at is
  'When the post was found gone from its source while its account was still readable (0131): deleted. Null: not known to be deleted.';
