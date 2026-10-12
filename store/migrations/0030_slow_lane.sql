-- 0030_slow_lane.sql
--
-- THE SLOW-BURN LANE, ADMITTED TO THE TWO PLACES A LANE IS WRITTEN.
--
-- The main catch-all lanes look back ten minutes, so a post that takes an hour to cross
-- the floor is never seen. The slow lane looks back six hours every fifteen minutes at a
-- higher floor (Policy.feed.slow). It keeps a floor of its own (feed_floor), and the posts
-- it finds first are credited to it (item_found_by), which is what lets them be scored and
-- reach the For You feed like any other — so both tables' lane CHECKs have to admit it.
--
-- What breaks if changed carelessly: the two lists are core's FEED_LANES, and
-- store/src/migrations.test.ts reads them from THIS file. A lane added to the vocabulary
-- and not here makes the first slow pass fail on the floor write, after it has paid.

alter table internal.feed_floor drop constraint feed_floor_lane_check;
alter table internal.feed_floor add constraint feed_floor_lane_check check (lane in ('all', 'media', 'slow'));

alter table internal.item_found_by drop constraint item_found_by_lane_check;
alter table internal.item_found_by add constraint item_found_by_lane_check check (lane in ('all', 'media', 'slow'));
