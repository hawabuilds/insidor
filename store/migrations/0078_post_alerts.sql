-- 0078_post_alerts.sql
--
-- THE OWNER'S PUSH LIST (2026-10-14): a coin found for a For You post, a coin that links one, a new
-- post on a story whose coin he confirmed, and a coin for a post he watches — the last one "within
-- seconds", from the mint stream. And, first, why no push had ever reached his phone.
--
-- 1. The alert service (insidor_people) may READ three public tables it now matches against:
--
--      public.same_name_coin   a post's coins, strongest first ("See 3 coins"): the first coin a
--                              For You post gets, and every new one for a watched post
--      public.post_name_idea   a post's name and ticker ideas (the namer's guesses first): what a
--                              coin new on the mint stream is compared with, for a watched post
--      public.market_reading   the last market cap we read for a coin, said in the push when the
--                              market source has not listed a brand-new coin yet
--
--    Read-only, and the same facts the app role already reads. Nothing in `internal` is granted:
--    the matching uses only what the app may show.
--
-- 2. people.push_subscription remembers what the push service last said for each device: the
--    status (201 taken; 403 a key the service refused; 0 no answer) and its short reason, and when.
--    Before this, a device that refused every push looked exactly like one that took them, and
--    "nothing arrives" had no row to look at.
--
-- No new table for the watch: people.post_watch (0068) is the list of watched posts, and
-- people.alert_claim already makes each (person, kind, subject) send once — a watched post's coin
-- is claimed as "post|coin", so the same coin never alerts twice and a second coin still does.
-- 0068's `notified_at` is no longer what decides; it is left as it was.
--
-- What breaks if changed carelessly: the grants are SELECT only. The alert service writes nothing
-- outside `people`; a write grant here would let a bug in it rewrite what every feed shows.

grant select on public.same_name_coin, public.post_name_idea, public.market_reading to insidor_people;

alter table people.push_subscription
  add column last_status  integer,
  add column last_reason  text,
  add column last_at      timestamptz;

comment on column people.push_subscription.last_status is
  'What the push service answered the last push to this device: 201 taken, 403/400 refused, 0 no answer. Null: never sent to.';
