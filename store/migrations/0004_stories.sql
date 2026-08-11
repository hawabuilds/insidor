-- 0004_stories.sql
--
-- Stories and membership. A story is the claim that several items are versions of
-- the same real-world moment.
--
-- Note what is NOT in this file: no match score, no similarity threshold, no
-- confidence. Membership records WHICH CARRIER joined an item to a story — a fact,
-- reproducible from the item — while the number that persuaded us lives in the
-- group stage's row in internal.decisions with its whole feature vector attached.
-- Splitting it that way is what makes "why is this post in this story" answerable
-- six months later without the answer being a float nobody can reconstruct.

create table public.story (
  story_id     text primary key,

  -- THREE CLOCKS, and they are not interchangeable.
  --   earliest_post_at  when the oldest member was posted    ← the mint-lag gate reads THIS
  --   promoted_at       when we decided it was a story
  --   last_member_at    the newest evidence the deciders were allowed to see
  earliest_post_at timestamptz,
  promoted_at      timestamptz not null default now(),
  last_member_at   timestamptz not null default now(),

  state        text not null default 'promoted'
                 check (state in ('promoted', 'qualified', 'rejected', 'retired')),

  -- Rendered to a person. Produced by the qualify stage from a judgement; null
  -- until then, and null is a legitimate long-term state — a story with nothing
  -- nameable in it is a normal outcome, not a gap to be filled with a placeholder.
  display_title text,
  thumb_uri     text,

  -- A merge keeps both ids alive and points the loser at the winner. Deleting the
  -- loser would orphan every decision already logged against its id, and the
  -- decision log is the one table that must never acquire dangling subjects.
  merged_into  text references public.story (story_id),

  member_count  integer not null default 0,
  author_count  integer not null default 0,
  source_count  integer not null default 0,

  constraint no_self_merge check (merged_into is distinct from story_id)
);

create index story_open_idx on public.story (last_member_at desc)
  where merged_into is null and state = 'promoted';
create index story_earliest_idx on public.story (earliest_post_at)
  where earliest_post_at is not null;
create index story_merged_idx on public.story (merged_into) where merged_into is not null;

create table public.story_member (
  story_id  text not null references public.story (story_id) on delete cascade,
  item_id   text not null references public.item (item_id) on delete cascade,
  joined_at timestamptz not null default now(),

  -- Which carrier did the joining. The first four are free, deterministic and
  -- language-blind; 'embedding' is the paid tier and is recorded separately so a
  -- query can always answer "what would tier 1 alone have grouped?" — the question
  -- the previous build could not answer because the column was NULL on every row.
  joined_by text not null check (joined_by in
              ('imageHash', 'textShingle', 'formatId', 'reproductionPointer', 'embedding', 'manual')),
  -- The specific carrier value that matched, so the join is re-checkable by hand.
  carrier_key text,
  is_seed   boolean not null default false,

  primary key (story_id, item_id)
);

create index story_member_item_idx on public.story_member (item_id);
create index story_member_tier_idx on public.story_member (story_id, joined_by);

/* ── term persistence buckets ─────────────────────────────────────────────
   Daily document frequency per term, used by the grouper's weighting:

     persistence(t) = (daily buckets in the last 14 where df(t) >= 3) / 14
     w(t)           = idf_24h(t) * (1 - persistence(t))

   Raw IDF would down-weight a genuinely new ticker exactly as it climbs from 1 to
   80 documents in a day, which is precisely when it matters. Persistence separates
   "common because it is ambient" from "common because it is happening now".

   ★ THE 14-DAY HISTORY ACCRUES FORWARD ONLY. The table has to be written from the
   first day the system runs or the feature does not exist three months later. It
   is here, in the migration that creates grouping, so nobody discovers it late. */

create table internal.term_daily (
  bucket_date date not null,
  term        text not null,
  df          integer not null check (df >= 0),
  updated_at  timestamptz not null default now(),
  primary key (bucket_date, term)
);

create index term_daily_term_idx on internal.term_daily (term, bucket_date desc);

grant select on public.story, public.story_member to insidor_app;
