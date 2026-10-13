-- 0065_feed_history.sql
--
-- WHAT EACH FEED SHOWED, HOUR BY HOUR: one row for every post that was on a feed at any
-- projection within an hour, so "how many posts did For You show per hour" is a count, not a
-- guess from logs.
--
-- public.rising_row holds only the frame that is showing now; each projection replaces it, so
-- what showed at 03:00 is gone by 03:01. This keeps the hour's set.
--
-- ONE ROW PER (HOUR, FEED, POST). The projector inserts every row of every frame; a post already
-- recorded for that hour is not inserted again, only its best position kept. So the table grows
-- by the hour's distinct posts, not by the number of frames.
--
--   hour            the projection's hour, truncated (UTC)
--   first_position  where the post was when first seen this hour (0 = top)
--   best_position   the highest it reached this hour
--   first_seen_at   the first projection this hour that showed it
--
-- Facts about what was on screen, nothing about why: the reasons a post left live in
-- public.feed_rejection (0049).
--
-- RETENTION: 14 days, pruned by the projector (store/src/repo/feed-history.ts). A few hundred rows
-- an hour; two weeks is enough to compare days and shifts, and nothing trains on this.
--
-- `internal`: a measurement of our own output, not a fact for the app.

create table internal.feed_history (
  hour            timestamptz not null,
  feed_id         text not null,
  item_id         text not null,
  first_position  int not null,
  best_position   int not null,
  first_seen_at   timestamptz not null,
  primary key (hour, feed_id, item_id)
);

comment on table internal.feed_history is
  'Each post shown on a feed within an hour (For You, Popular, News): first and best position, first seen. Pruned after 14 days.';
