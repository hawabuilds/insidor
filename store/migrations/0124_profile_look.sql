-- 0124_profile_look.sql
--
-- WHAT A PERSON CHOOSES FOR THEIR OWN PROFILE: the name shown, their own picture and a banner (the
-- owner's approved profile, 2026-10-22: "Edit profile: name, bio, picture, banner").
--
-- `name` and `picture_url` are the sign-in's: services/social syncProfile writes them from the signed
-- X identity every few minutes, so an edit stored there would be overwritten within the hour. What
-- the person picks lives beside them and wins when set; clearing it goes back to the sign-in's.
--
--   display_name  the name they typed; null shows the sign-in's name
--   picture_file  their uploaded picture, a file name in the public bucket's `author-pics/` folder
--                 (32 hex characters, the same folder and rule as a poster's copied picture, 0079),
--                 so the app builds its path exactly as it does every other face; null shows the X
--                 picture
--   banner_file   their uploaded banner, the same folder and rule; null draws the default pattern
--
-- `people`, written only by insidor_people (0043's table grant covers the new columns). A file name
-- is never a path: the check below is the whole of what the app will ever be pointed at.
--
-- What breaks if changed carelessly: the 32-hex checks. The app refuses any other file name and
-- falls back to the X picture, so a looser rule here would store pictures nobody sees.

alter table people.profile
  add column display_name text check (display_name is null or length(display_name) between 1 and 50),
  add column picture_file text check (picture_file is null or picture_file ~ '^[0-9a-f]{32}$'),
  add column banner_file  text check (banner_file is null or banner_file ~ '^[0-9a-f]{32}$');

comment on column people.profile.display_name is
  'The name the person typed in Edit profile; null shows the sign-in name in `name`.';
comment on column people.profile.picture_file is
  'Their uploaded picture: a 32-hex file name in the public bucket folder author-pics/. Null: the sign-in picture.';
comment on column people.profile.banner_file is
  'Their uploaded banner: a 32-hex file name in the public bucket folder author-pics/. Null: the default pattern.';
