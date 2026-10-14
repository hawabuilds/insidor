-- 0075_feed_post.sql
--
-- EVERY POST THAT EVER MADE IT ONTO FOR YOU OR POPULAR, with when it first did (the owner,
-- 2026-10-14: "FYP shows every post that ever made it, newest first", scrolled without end).
--
-- public.rising_row is the frame showing NOW: the projector replaces it every run, caps it at
-- `rising.maxRows` and keeps only a day's posts, so a post that left it is gone from the app.
-- internal.feed_history (0063) keeps the hour's set, but it is a measurement of our own output,
-- pruned after 14 days, and the app role cannot read it. This is the app's list of members: a
-- post is added the first time a frame shows it and is never taken out by the projector's own
-- rules — the six-hour rule, the day's window, the cap or a judge's later answer. It is
-- withdrawn only when the owner calls it not a meme, and comes back if the owner changes that
-- call.
--
--   first_shown_at  the first frame that showed it: the scroll's order and its cursor; never
--                   rewritten, so a page boundary stays where the phone left it
--   last_shown_at   the last frame that showed it
--   payload         the card exactly as rising_row carries it (services/project rising.ts);
--                   null for a member carried over from 0063 that has not been projected yet,
--                   which the read service leaves out rather than sending half
--   payload_at      when that payload was projected: the read service dashes a coin's market
--                   numbers on a payload older than the market's freshness bar, so a card never
--                   shows a stale cap as the current one
--   tried_at        when the projector last tried to project it again: the refresh takes the
--                   longest-untried first, so a post that can no longer be projected (its item
--                   gone) does not hold the head of the queue and starve the rest
--   withdrawn_at    when the owner's "Not a meme" took it out; null while it is on the list
--
-- Facts about what was on screen, nothing about why: no score, no rank, no route.
--
-- No retention: a few hundred posts a day; the read is one index range per page.

create table public.feed_post (
  feed_id         text not null check (feed_id in ('fyp', 'popular')),
  item_id         text not null,
  first_shown_at  timestamptz not null,
  last_shown_at   timestamptz not null,
  payload         jsonb,
  payload_at      timestamptz,
  tried_at        timestamptz,
  withdrawn_at    timestamptz,
  primary key (feed_id, item_id)
);

/* The scroll: one feed's members newest-joined first, from a cursor. */
create index feed_post_scroll_idx on public.feed_post (feed_id, first_shown_at desc, item_id desc);
/* The projector's refresh: the longest-untried first. */
create index feed_post_refresh_idx on public.feed_post (tried_at asc nulls first);

comment on table public.feed_post is
  'Every post that was ever on For You or Popular, with when it first showed; withdrawn only by the owner''s Not a meme. The infinite scroll reads it.';

/* The members we already know of: every post 0063 recorded since it was applied, joined at the
   first hour it was seen. Their cards are projected by the next runs (oldest first). */
insert into public.feed_post (feed_id, item_id, first_shown_at, last_shown_at)
select h.feed_id, h.item_id, min(h.first_seen_at), max(h.first_seen_at)
  from internal.feed_history h
 where h.feed_id in ('fyp', 'popular')
 group by h.feed_id, h.item_id
on conflict (feed_id, item_id) do nothing;

/* 0073's rule for every table in `public`: row security on, our four roles let through. */
alter table public.feed_post enable row level security;
create policy insidor_roles on public.feed_post for all
  to insidor_app, insidor_people, insidor_service, insidor_internal using (true) with check (true);

grant select on public.feed_post to insidor_app;
