-- 0106_narratives_permanent.sql
--
-- NARRATIVES ARE PERMANENT: what the board, the All time list and an old link read once a narrative
-- is no longer rebuilt every two minutes.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-18: "I can't see narratives from a few days ago in the app. Fix it so
-- narratives never disappear." Until now the runner rewrote internal.narrative_member whole each
-- pass from the last two days of posts, retired every narrative no new group took (387 of the 496
-- ever made, 16-18 Oct: 208 'gone', 179 'merged' — 89 of those folded into one "viral cat" story),
-- and the projector deleted the page of every narrative off its 200-row board. Now a narrative's
-- posts are only added to (core group/narrative-keep.ts), a narrative leaves only by the owner's
-- "Not a narrative", and its page stays.
--
-- ── WHAT IS ADDED ────────────────────────────────────────────────────────
--
-- internal.narrative.restored_at  set by tools/narrative-rebuild.ts on a narrative it rebuilt from
--                                 stored posts. The backward search skips these (the rebuild already
--                                 matched seven days of stored posts, and asking again would spend on
--                                 the past), and the re-tune does not count them as shown that day.
-- narrative_board_idx              the board's read: the newest open narratives first.
-- public.story_view's facts        found_at, views_total, newest_post_at, dead — copied from the page
--                                  by the projector as it writes it, so the All time list (services/read
--                                  GET /narratives/:view/all) orders and pages by an index, never by
--                                  reading every page's JSON. NULL on a page written before 0106 or a
--                                  page that does not say: an unknown sorts last, never as 0.
-- public.story_alias               a narrative the owner merged (or one the old regroup folded away,
--                                  16-18 Oct): its id → the narrative its posts are in now. GET
--                                  /story/:id serves the survivor's page for it, so an old link opens
--                                  the story rather than a 404. Written by the projector from
--                                  internal.narrative each frame; the app reads it.
--
-- What breaks if changed carelessly: story_view's columns are a copy of the payload, written in the
-- same statement as it. A writer that sets the payload and not the columns leaves the list ordering
-- by a stale number; services/project db.ts `writeStories` is the one writer.

alter table internal.narrative add column restored_at timestamptz;
comment on column internal.narrative.restored_at is
  'When tools/narrative-rebuild.ts rebuilt it from stored posts; null for a narrative the runner made.';

create index narrative_board_idx on internal.narrative (newest_post_at desc nulls last) where state = 'open' and shown;

alter table public.story_view add column found_at timestamptz;
alter table public.story_view add column views_total bigint;
alter table public.story_view add column newest_post_at timestamptz;
alter table public.story_view add column dead boolean;

create index story_view_views_idx on public.story_view (views_total desc nulls last, story_id);
create index story_view_found_idx on public.story_view (found_at desc nulls last, story_id);

create table public.story_alias (
  story_id       text primary key,
  into_story_id  text not null,
  projected_at   timestamptz not null default now(),
  constraint story_alias_not_itself check (story_id <> into_story_id)
);
comment on table public.story_alias is
  'A merged narrative''s id and the narrative its posts are in now: an old link opens the survivor.';
grant select on public.story_alias to insidor_app;
