-- 0118_coin_first_origin.sql
--
-- THE COIN-FIRST ROUTE SHOWS THE ORIGINAL POST, NEVER THE LAUNCHER'S POINTER TO IT: the posts a post's
-- own links name, and which of the route's posts is the original and which only pointed at it.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-20: a coin's own link is usually the launcher's post explaining someone else's
-- viral post — quoting it, linking it by URL, or re-uploading its video — and For You showed that
-- pointer ("i want to see the original viral post not the tweet a degen who launched the coin made
-- to explain the viral post"). The Laura coin linked theogdeveloper1's quote of AlexesNakamoto's
-- video; HI linked HumainISol's quote of prtygal777's baby. The route (services/runner
-- work/coin-first.ts, core match/coin-origin.ts) now walks from the coin's linked post to the
-- original, and judges, credits and admits only that.
--
-- internal.post_reference  one row per post whose links the source told us: the posts of the same
--                          source those links name, in order (an empty list when none is a post).
--                          A post with no row was never read with its links: unknown, not "none".
--                          Its own table rather than a public.item column, so a runner deployed
--                          before this migration keeps storing posts.
--
-- internal.coin_first_post gains:
--   role               'original' (the post the route judges and may admit) or 'pointer' (the
--                      coin's linked post that only pointed at another, or a launcher's own post
--                      with nothing to follow: never judged, credited or admitted by the route)
--   pointer_item_id    for an original reached from the coin's linked post, that linked post; the
--                      one-coin step ties every coin linking the pointer to the original through it
--   resolved_by        the hops from the pointer, joined by '>' ('quote', 'quote>link', ...)
--
-- Internal only, like 0117: the route's reasoning never reaches a screen.
--
-- What breaks if changed carelessly: `role` defaults to 'original', so the rows 0117 wrote stay what
-- they were; a pointer written as an original would be judged and put on For You again.

create table internal.post_reference (
  item_id    text primary key check (length(item_id) between 1 and 200),
  refers_to  text[] not null,
  read_at    timestamptz not null
);

comment on table internal.post_reference is
  'The posts of the same source that a post''s own links name, as its source last told us. No row: never read with its links. Internal; never shown.';

alter table internal.coin_first_post
  add column role text not null default 'original' check (role in ('original', 'pointer')),
  add column pointer_item_id text check (pointer_item_id is null or length(pointer_item_id) between 1 and 200),
  add column resolved_by text check (resolved_by is null or length(resolved_by) between 1 and 100);

create index coin_first_post_pointer_idx on internal.coin_first_post (pointer_item_id) where pointer_item_id is not null;

-- The walk's re-upload hop finds an earlier post with the same first picture or video by its address
-- every pass; scanning two days of posts for it took 350 ms on 20 Oct (184,000 posts in all).
create index item_first_media_idx on public.item ((media->0->>'uri')) where media->0->>'uri' is not null;
