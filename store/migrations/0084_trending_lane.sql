-- 0084_trending_lane.sql
--
-- ONE MORE WAY A POST CAN BE FOUND: the short-video source's own recommendation feed, read
-- logged out (the runner's work/trending-feed.ts), credited to the lane 'trending'.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- Every other lane asks a word or a name. The owner's missed short videos of 2026-10-14 include
-- ones tagged only #fyp, which no word reaches; the feed asks nothing, so it is the one lane that
-- can return them. Its own lane, not 'trend' (a trend word's search), so the finders report and
-- the lead-time numbers can tell the feed's catches from the searches'.
--
-- What breaks if changed carelessly: dropping an old lane value from the check (every row written
-- names one). Until this is applied, the feed's credit is refused by the old check and the runner's
-- step logs a failure each slot; its switch (Policy.finders.trending.on) is off until it is.

alter table internal.item_found_by drop constraint item_found_by_lane_check;
alter table internal.item_found_by add constraint item_found_by_lane_check
  check (lane in ('all', 'media', 'slow', 'watch', 'coin_link', 'x_repost', 'trend', 'creator', 'trending'));
