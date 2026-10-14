-- 0080_author_bio.sql
--
-- A POSTER'S PROFILE TEXT, KEPT WITH WHEN WE READ IT (the owner, 2026-10-14: "some of these
-- tiktok accounts had the ca in their bio").
--
-- Every read of a post carries its account, and on both sources the account carries its profile
-- text (the short-video source's `signature`, the text source's `profile_bio`). Until now it was
-- dropped at the upsert. The coin match (services/project post-match.ts, core match/poster-bio.ts)
-- reads coin addresses out of it: a coin whose address the poster put in their own profile, and
-- that launched in the timing window after the post, is that post's coin.
--
-- ★ ONE ROW PER DISTINCT TEXT, NOT ONE PER ACCOUNT. A creator adds the address hours after the
-- launch and often takes it down a day or two later, when the next coin comes. A single
-- overwritten column would forget the address the moment the profile changed, and the match
-- would un-prove a coin it had proven. So each text the account ever showed is a row, with the
-- first and last time we read it; the newest row is the account's profile now.
--
--   bio            the text as read, links written out after it; '' is a profile read and blank
--   first_read_at  the first read that showed this exact text
--   last_read_at   the newest read that showed it (moved on every read, so a stale text is visible)
--
-- `internal`, like every table the match reads: the app role has no USAGE here. The text itself is
-- a fact about the world, but which address in it we took for a post's coin is our reasoning.
--
-- What breaks if changed carelessly: the key. It is (author_key, md5(bio)) so a long profile still
-- fits an index; keying on the text alone would make every account share one blank row. The
-- writer (store/src/repo/authors.ts) skips this table quietly while it is missing, so the code
-- runs before this migration and stores nothing until it is applied.

create table internal.author_bio_reading (
  author_key    text not null references public.author (author_key),
  bio           text not null,
  bio_md5       text not null generated always as (md5(bio)) stored,
  first_read_at timestamptz not null,
  last_read_at  timestamptz not null,
  primary key (author_key, bio_md5)
);

create index author_bio_reading_newest_idx on internal.author_bio_reading (author_key, last_read_at desc);

comment on table internal.author_bio_reading is
  'Each distinct profile text an account showed, with the first and last read that showed it. The coin match reads addresses out of it.';
