-- 0050_alerts_skip_hidden.sql
--
-- THE ALERTS LIST LEAVES OUT ANYTHING THE FEEDS HAVE SINCE HIDDEN.
--
-- An alert is sent about a post on For You or a narrative on the board, and nothing hidden is on
-- either, so no new alert can be about something hidden. But an alert sent BEFORE its post or
-- narrative was hidden is still in people.alert. The notify service's list skips any alert whose
-- subject (a post id, a story id, or "story id|coin" for a coin match) is in public.feed_rejection.
-- The alert row itself is kept, like the rejection: hiding is the list's choice.
--
-- This grants the people role read access to that one table, so the list can ask. The app role is
-- still not granted it: the reason something was hidden never reaches a screen, only the fact
-- that it is not listed.

grant select on public.feed_rejection to insidor_people;
