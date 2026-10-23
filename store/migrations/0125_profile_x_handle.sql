-- 0125_profile_x_handle.sql
--
-- THE X ACCOUNT, KEPT APART FROM THE USERNAME. Until sign-up let people pick a username (0123), a
-- profile's `handle` was always the X handle of an X sign-in, and the profile's X button linked to
-- it. Now `handle` is a chosen name and email or Google members have no X account at all, so the
-- button pointed a stranger's name at x.com (the owner, 2026-10-23). `x_handle` is written only from
-- a signed X identity (services/social syncProfile); null means no X account, and the app draws no
-- X button.
--
-- Backfill: every profile made before sign-up gained other methods (the 0123 release, 23:03 UTC on
-- 2026-10-22) came from an X sign-in whose handle was copied from X, so its handle is its X handle.
-- Anyone later gets theirs at their next sign-in sync, within minutes of opening the app.
--
-- What breaks if changed carelessly: filling x_handle from `handle` for anyone else. A chosen
-- username that happens to match someone's X name would link to that stranger's account.

alter table people.profile
  add column x_handle text check (x_handle is null or x_handle ~ '^[A-Za-z0-9_]{1,15}$');

comment on column people.profile.x_handle is
  'The X handle from a signed X sign-in, without @; null when the person has no X sign-in. Drives the profile''s X button.';

update people.profile
   set x_handle = handle
 where handle is not null
   and handle ~ '^[A-Za-z0-9_]{1,15}$'
   and created_at < timestamptz '2026-10-22 23:03:00+00';
