-- 0032_backfill.sql
--
-- WHERE A NARRATIVE STARTED: WHICH POSTS WE WENT BACK FOR, AND WHAT EACH LOOK COST.
--
-- We often catch a moment late. Once a story is promoted, the backfill follows its posts'
-- quotes back to the post they quote, and those posts join the story through GROUP's own
-- rules like any other. Two facts had nowhere to live:
--
--   item_backfill   a post we fetched BECAUSE of a story, how, and from which post. GROUP
--                   reads it: such a post is compared with that story alone, and if it
--                   does not join, it seeds nothing — a backfill never invents a story.
--                   `reached_from` is the post that quoted it, which is the lineage GROUP
--                   needs and what proves "started by" on screen.
--   story_backfill  one row per story, rewritten each time it is backfilled: when, at how
--                   many members (so it runs again only when new members arrive), what it
--                   fetched, and what it cost.
--
-- `internal`, no grant: why we fetched a post is our reasoning. The post itself is public.

create table internal.item_backfill (
  item_id       text primary key references public.item (item_id) on delete cascade,
  story_id      text not null references public.story (story_id) on delete cascade,
  via           text not null check (via in ('quote')),
  reached_from  text references public.item (item_id) on delete set null,
  found_at      timestamptz not null
);

create index item_backfill_story_idx on internal.item_backfill (story_id);

create table internal.story_backfill (
  story_id      text primary key references public.story (story_id) on delete cascade,
  ran_at        timestamptz not null,
  members_at    integer not null check (members_at >= 0),
  quoted_posts  integer not null check (quoted_posts >= 0),
  cost_usd      numeric(12, 8) not null check (cost_usd >= 0)
);

create index story_backfill_day_idx on internal.story_backfill (ran_at);

comment on table internal.item_backfill is
  'A post fetched because of a promoted story, and how it was reached. GROUP compares it with that story only and never seeds a story from it.';
comment on table internal.story_backfill is
  'The last backfill of each promoted story: when, at how many members, what it fetched and what it cost. A story is backfilled again only when it has more members than this.';
