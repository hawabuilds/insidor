-- 0061_watch_lane.sql
--
-- THE SHORT-VIDEO SOURCE'S WATCH COUNTS AS A LANE, so its posts are judged and can reach For You.
--
-- `internal.item_found_by` is what the per-post score and the For You feed read: only a post a
-- catch-all lane found is judged and shown (0025). The short-video source has no catch-all search,
-- only the owner's watch list in policy (feed.hashtags), asked one word at a time — and that ask
-- wrote nothing here, so 233 of its posts were stored on 2026-10-13 and not one was judged.
--
-- 'watch' is that list's lane. The runner credits it only to posts from the last day
-- (Policy.feed.watchMaxAgeMs): the search is asked for its most-liked videos of the past 24 hours,
-- and a post older than that, whatever the vendor sent, is stored and never credited.
--
-- What breaks if changed carelessly: dropping the old values. Every row already written names
-- 'all', 'media' or 'slow', and the check must keep accepting them.

alter table internal.item_found_by drop constraint item_found_by_lane_check;
alter table internal.item_found_by add constraint item_found_by_lane_check check (lane in ('all', 'media', 'slow', 'watch'));
