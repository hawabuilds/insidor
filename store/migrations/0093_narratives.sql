-- 0093_narratives.sql
--
-- NARRATIVES: the posts the judge passed, grouped by what they are about — what the Narratives
-- tab lists, what the post sheet's "Part of the … story" line names, and what the story coins read
-- as "the same story" (the owner, 2026-10-16). Written by the runner (services/runner
-- work/narratives.ts) every couple of minutes; read by the projector, which puts them on the board
-- and on each feed post, and by services/social, which saves the owner's calls on them.
--
-- ── WHY NOT public.story ─────────────────────────────────────────────────
--
-- public.story is the GROUP stage's: a candidate story seeded from every admitted item and joined
-- on carriers, before anyone has said the post is worth showing — 46,000 candidates in four days,
-- and the board's narratives were built from ads, shills and posts the owner hid. A narrative is
-- built only from good posts, on meaning and one shared detail (core group/narrative.ts), and is
-- regrouped from scratch each pass. Writing that into public.story would put two groupers on one
-- table, each undoing the other's merges. The GROUP stage keeps its table; nothing on screen reads
-- its stories any more.
--
-- `internal`, because which posts we group together is the system's own reasoning: the screen gets
-- the finished narrative through the projector's payloads (public.story_view, public.rising_row),
-- never these rows.
--
-- ── THE TABLES ───────────────────────────────────────────────────────────
--
--   internal.narrative         one row per narrative id the grouping ever gave out. `state` open,
--                              merged (into `merged_into`) or gone. An id is kept by overlap from
--                              pass to pass, so a link to a narrative, and the owner's calls on
--                              it, survive its growth. `posts_changed_at` is when its post set last
--                              changed: the owner's "Not a narrative" hides it until then.
--                              `shown` is whether it met the owner's rule at the last pass (two good
--                              posts, or one huge and climbing); `first_shown_at` is for the re-tune's
--                              count of narratives shown. `title` is the cheap model's, with the post
--                              count it was written for and the model; null until written.
--   internal.narrative_member  its posts NOW: rewritten whole each pass (a post is in at most one
--                              open narrative, which the unique index holds). History is not kept
--                              here; the owner's calls carry the posts they were about.
--
--   public.story_post          the projector's own answer to "which narrative is this post in": one
--                              row per post on a board narrative, with its title and post count,
--                              written with the board. The read service (app role) reads it for the
--                              cards' narrative tag and the post sheet's narrative tile.
--
-- ── THE OWNER'S CALLS ON A NARRATIVE (internal.owner_feedback, 0054) ─────
--
-- subject_kind 'narrative', item_id the narrative's id, and a verdict:
--   not_narrative   hide it; its posts are not grouped together again
--   merge           it is the same story as `other_id`; their posts are joined
--   remove_post     the post `other_id` does not belong in it
--   right / wrong   `coin_address` is (or is not) the narrative's coin; `cleared` takes both back
-- `members` is the narrative's posts when the call was made and `other_members` the other
-- narrative's (merge), both read by the SERVER from internal.narrative_member — never from the
-- request — so the call still says which posts it was about after the ids have moved on. Append-
-- only like every other call, the trigger is 0054's.
--
-- The runner (insidor_internal) gets DELETE on internal.narrative_member, which it rewrites each
-- pass; 0001's defaults give it select, insert and update in `internal` and nothing more.
-- The people role gets SELECT on the two narrative tables: services/social reads a narrative's
-- posts to store them with the call, and checks the post being removed is one of them.
--
-- What breaks if changed carelessly: the owner_feedback CHECK is replaced whole, never loosened;
-- every old verdict stays allowed, so no stored row fails it.

create table internal.narrative (
  narrative_id      text primary key check (length(narrative_id) between 1 and 200),
  state             text not null default 'open' check (state in ('open', 'merged', 'gone')),
  merged_into       text,
  anchor_item       text not null,
  member_count      integer not null check (member_count >= 0),
  newest_post_at    timestamptz,
  shown             boolean not null default false,
  first_shown_at    timestamptz,
  posts_changed_at  timestamptz not null default now(),
  title             text check (title is null or length(title) between 1 and 120),
  title_posts       integer,
  title_model       text,
  titled_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint narrative_merged_points_somewhere check ((state = 'merged') = (merged_into is not null))
);

create index narrative_open_idx on internal.narrative (updated_at desc) where state = 'open';
create index narrative_shown_idx on internal.narrative (first_shown_at) where first_shown_at is not null;

create table internal.narrative_member (
  narrative_id  text not null references internal.narrative (narrative_id),
  item_id       text not null,
  joined_at     timestamptz not null default now(),
  primary key (narrative_id, item_id)
);

create unique index narrative_member_item_uq on internal.narrative_member (item_id);

comment on table internal.narrative is
  'Narratives: posts the judge passed, grouped on meaning and one shared detail (core group/narrative.ts). Written by the runner, read by the projector and services/social.';
comment on table internal.narrative_member is
  'Each open narrative''s posts now, rewritten whole every grouping pass; a post is in at most one.';

alter table internal.owner_feedback add column other_id text check (other_id is null or length(other_id) between 1 and 200);
alter table internal.owner_feedback add column members text[];
alter table internal.owner_feedback add column other_members text[];

alter table internal.owner_feedback drop constraint owner_feedback_check;
alter table internal.owner_feedback add constraint owner_feedback_check check (
  (subject_kind = 'post' and verdict in ('meme', 'not') and coin_address is null and name is null)
  or (subject_kind = 'coin_match' and verdict in ('right', 'wrong', 'none', 'cleared') and (verdict not in ('none', 'cleared') or coin_address is null))
  or (subject_kind = 'name' and verdict in ('up', 'down') and name is not null)
  or (subject_kind = 'narrative' and name is null and (
        (verdict = 'not_narrative' and coin_address is null)
     or (verdict = 'merge' and other_id is not null and coin_address is null)
     or (verdict = 'remove_post' and other_id is not null and coin_address is null)
     or (verdict in ('right', 'wrong') and coin_address is not null)
     or (verdict = 'cleared' and coin_address is null)))
);

alter table internal.owner_feedback drop constraint owner_feedback_subject_kind_check;
alter table internal.owner_feedback add constraint owner_feedback_subject_kind_check
  check (subject_kind in ('post', 'coin_match', 'name', 'narrative'));

/* ★ THE ONE PUBLIC ROW PER POST: which narrative on the board it is part of, written by the
   projector in the frame that writes the board, so a card's tag, the post sheet's tile and the board
   name the same narrative with the same post count. Rewritten whole each frame. */
create table public.story_post (
  item_id       text primary key,
  story_id      text not null,
  title         text not null,
  posts         integer not null check (posts >= 1),
  projected_at  timestamptz not null default now()
);
create index story_post_story_idx on public.story_post (story_id);
comment on table public.story_post is
  'Each post on a board narrative: the narrative id, its title and how many posts it lists, as the frame that wrote the board projected them.';
grant select on public.story_post to insidor_app;

grant select on internal.narrative, internal.narrative_member to insidor_people;
/* The runner rewrites a narrative's posts each pass; 0001's defaults give it no DELETE in internal. */
grant delete on internal.narrative_member to insidor_internal;

comment on table internal.owner_feedback is
  'The owner''s calls from the phone (post meme/not, coin match right/wrong/none/cleared, name up/down, narrative not_narrative/merge/remove_post/right/wrong/cleared), append-only; the newest row per item (and name) is the current call, and a newest `cleared` coin call is no call.';
