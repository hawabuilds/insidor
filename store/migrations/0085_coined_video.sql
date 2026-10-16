-- 0085_coined_video.sql
--
-- THE SHORT-VIDEO TRAINING SET: every short video a coin was made from, with what we can still
-- learn from it, and the record of each re-tune of the short-video settings.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-16: "TikTok: make it work like X and get as good, tuned from coined TikToks,
-- not copied from X." The coined short videos are scattered over five places (coin_post_link,
-- the owner's coin calls, his missed posts, public.item, the founders' sheets under eval/), and of
-- the 193 a coin's links named in the week to 2026-10-16 we held 8: the rest were never found, so
-- their words, tags and sound are nowhere. This table is the one list, written by
-- tools/lib/coined-videos.ts at every re-tune check (every ten minutes, free) and filled out by a
-- re-fetch when one is allowed. What is learned from it — the speed bar, tags, sounds, creators,
-- names, the judge's precedents — reads it here.
--
-- internal.coined_video        one row per coined short video. `first_coin` is the earliest-launched
--                              coin (copycats come later, the owner's rule from 0083); `peak_usd`
--                              the highest market cap WE read for it, null when we never read one.
--                              `views_30m` / `_1h` / `_2h` are from our own readings only, and null
--                              when no two readings bracket that age closely: an estimate from a
--                              reading a day later is not a reading at 30 minutes. `fetch_state`
--                              says how the words were got: held (we found it), fetched (read
--                              again by id), gone (asked; the source no longer has it), unfetched
--                              (not asked yet).
-- internal.short_video_tuning  one row per re-tune's short-video part: what was learned, the gate's
--                              numbers against the setup live now, and whether it held.
--
-- What breaks if changed carelessly: making `first_coin` anything but the earliest launch (a copycat
-- counted as the first would flatter every lead time), or filling `views_*` from a later reading.
-- The learned speed bar is only as honest as those three columns.

create table internal.coined_video (
  item_id          text primary key check (length(item_id) between 3 and 80),
  source           text not null,
  source_item_id   text not null check (length(source_item_id) between 1 and 64),
  handle           text check (handle is null or length(handle) <= 100),
  posted_at        timestamptz,
  caption          text check (caption is null or length(caption) <= 4000),
  tags             text[] not null default '{}',
  sound            text check (sound is null or length(sound) <= 200),
  sound_title      text check (sound_title is null or length(sound_title) <= 300),
  kind             text check (kind is null or length(kind) <= 60),
  first_coin       text not null,
  first_coin_at    timestamptz,
  coin_name        text check (coin_name is null or length(coin_name) <= 200),
  coin_ticker      text check (coin_ticker is null or length(coin_ticker) <= 64),
  coins            int not null default 1,
  peak_usd         double precision,
  found_from       text[] not null default '{}',
  views_30m        double precision,
  views_1h         double precision,
  views_2h         double precision,
  first_read_min   double precision,
  first_read_views double precision,
  latest_views     double precision,
  fetch_state      text not null check (fetch_state in ('held', 'fetched', 'gone', 'unfetched')),
  fetched_at       timestamptz,
  added_at         timestamptz not null,
  updated_at       timestamptz not null
);
create index coined_video_coin_at_idx on internal.coined_video (first_coin_at desc);

comment on table internal.coined_video is
  'The short-video training set: every short video a coin was made from (coin links, the owner''s coin calls and missed posts, the founders'' sheets), with its first coin, the highest market cap we read, and its views at 30 minutes, 1 and 2 hours from our own readings only.';

create table internal.short_video_tuning (
  id          bigserial primary key,
  slot        timestamptz not null,
  ran_at      timestamptz not null,
  set_size    int not null,
  learned     jsonb not null,
  gate        jsonb,
  held        boolean,
  why         text check (why is null or length(why) <= 2000),
  gap         text check (gap is null or length(gap) <= 2000)
);
create index short_video_tuning_slot_idx on internal.short_video_tuning (slot desc);

comment on table internal.short_video_tuning is
  'Each re-tune''s short-video part: the training set''s size, what it learned (speed bar, tags, sounds, creators), the gate against the setup live now, and the biggest gap to the text source.';
