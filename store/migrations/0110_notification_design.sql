-- 0110_notification_design.sql
--
-- THE OWNER'S NOTIFICATION DESIGN (2026-10-18): what the alert service needs to read and find for
-- the pushes it added — a coin you made getting its first buyers, and new followers and likes
-- pushed as one group.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- "A coin you made gets its first buyers" is pushed by services/notify (creator-buyers.ts), which
-- runs as `insidor_people`. Which coins were made through Insidor, and by which wallet, is
-- public.created_coin (0040), granted so far to the app role only. Reading it is reading a fact on
-- the chain for anyone to see; the alert service matches the creator's wallet to a profile.
--
-- Follows and likes are listed one by one and pushed as one group (deliver.ts `deliverGroups`):
-- each is written to people.alert with delivery 'held' until its group goes. The group pass looks
-- for held rows every few seconds; people.alert grows by thousands of rows a day (every For You
-- post is listed for everyone), so the held rows get their own small index rather than a scan.
--
-- ── WHAT IS ADDED ────────────────────────────────────────────────────────
--
-- grant select on public.created_coin to insidor_people
-- people.alert_held_idx   (user_id, kind) where delivery = 'held'
--
-- What breaks if changed carelessly: the index's predicate. The group pass asks for exactly
-- delivery = 'held'; an index on another value is never used and the pass scans the table.

grant select on public.created_coin to insidor_people;

create index alert_held_idx on people.alert (user_id, kind) where delivery = 'held';
