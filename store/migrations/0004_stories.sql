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

  -- FOUR CLOCKS, and they are not interchangeable.
  --   created_at        when the row appeared, i.e. when the seed arrived
  --   earliest_post_at  when the oldest member was posted    ← the mint-lag gate reads THIS
  --   promoted_at       when it crossed the promotion bar; NULL while a candidate
  --   last_member_at    the newest evidence the deciders were allowed to see
  created_at       timestamptz not null default now(),
  earliest_post_at timestamptz not null,
  promoted_at      timestamptz,
  last_member_at   timestamptz not null default now(),

  -- The four states of contracts/src/story.ts, spelled the same way here. A story
  -- starts as a candidate — it has members and has earned nothing yet — and the
  -- default says so; the previous default of 'promoted' would have made every
  -- arriving group promoted by omission.
  state        text not null default 'candidate'
                 check (state in ('candidate', 'promoted', 'merged', 'closed')),

  -- The carriers that define membership. A joining item is tested against these,
  -- so they live on the story rather than being re-derived from its members.
  carriers     jsonb not null default '[]'::jsonb,

  -- Rendered to a person. Produced by the qualify stage from a judgement; null
  -- until then, and null is a legitimate long-term state — a story with nothing
  -- nameable in it is a normal outcome, not a gap to be filled with a placeholder.
  --
  -- ★ NEITHER OF THESE IS A FIELD ON `Story`. Presentation is not part of the
  -- analytical object; it is written through StoryRepo.setPresentation and read by
  -- the projection. A column being richer than the type is fine. A type growing a
  -- field because a column exists is how the vocabulary rots.
  display_title text,
  thumb_uri     text,

  -- A merge keeps both ids alive and points the loser at the winner. Deleting the
  -- loser would orphan every decision already logged against its id, and the
  -- decision log is the one table that must never acquire dangling subjects.
  merged_into  text references public.story (story_id),
  merged_at    timestamptz,

  member_count     integer not null default 0,
  -- Breadth, not volume: one author posting forty times is not forty reproducers.
  distinct_authors integer not null default 0,
  distinct_sources integer not null default 0,

  constraint no_self_merge check (merged_into is distinct from story_id),
  -- 'merged' and a merge target are the same fact stated twice; neither may exist
  -- without the other, or `mergedInto` stops being followable.
  constraint merged_points_somewhere check ((state = 'merged') = (merged_into is not null)),
  constraint promoted_has_a_clock check (state <> 'promoted' or promoted_at is not null)
);

-- Stories an arriving item could still join. Candidates accrete exactly as
-- promoted stories do — promotion is about what downstream stages may look at, not
-- about whether membership is still open.
create index story_open_idx on public.story (last_member_at desc)
  where merged_into is null and state in ('candidate', 'promoted');
create index story_earliest_idx on public.story (earliest_post_at);
create index story_merged_idx on public.story (merged_into) where merged_into is not null;

create table public.story_member (
  story_id  text not null references public.story (story_id) on delete cascade,
  item_id   text not null references public.item (item_id) on delete cascade,
  joined_at timestamptz not null default now(),

  -- ★ WHY WE BELIEVE THIS ITEM BELONGS HERE, as the flattened spelling of the
  -- MatchEvidence union in contracts/src/story.ts. The kind selects which of the
  -- columns below are set, and the constraints make that selection an invariant
  -- rather than a convention — a row cannot claim to be a carrier join and then
  -- carry a similarity instead.
  --
  -- The tiers stay distinguishable on purpose: 'carrier' and 'lineage' are the free,
  -- deterministic, language-blind joins, 'representation' is the paid tier. A query
  -- can therefore always answer "what would tier 1 alone have grouped?" — the
  -- question the previous build could not answer because its column was NULL
  -- on every row.
  evidence_kind text not null check (evidence_kind in
                  ('seed', 'carrier', 'lineage', 'representation', 'adjudicated')),

  -- kind = 'carrier'. The specific carrier value that matched, so the join is
  -- re-checkable by hand; distance is null for the exact-match carrier kinds.
  carrier_kind     text check (carrier_kind in
                     ('imageHash', 'textShingle', 'formatId', 'entitySpan')),
  carrier_key      text,
  carrier_distance double precision,
  -- The carrier's weight at join time. A carrier everyone uses is not evidence, and
  -- what it was worth THEN is not recoverable from what it is worth now.
  carrier_weight   double precision,

  -- kind = 'lineage'. An explicit pointer from one item to another.
  lineage_via     text check (lineage_via in ('reproduction', 'rebroadcast')),
  lineage_to_item text references public.item (item_id),

  -- kind = 'representation'. The space is recorded because a bar tuned on one space
  -- is meaningless on another, and a bare cosine with no space is exactly that.
  representation_similarity double precision,
  representation_space      text,

  -- kind = 'adjudicated'. Rare, and the source of the labels the model is fit on.
  adjudicated_by text,
  adjudicated_at timestamptz,

  constraint evidence_carrier_is_whole check
    ((evidence_kind = 'carrier') =
     (carrier_kind is not null and carrier_key is not null and carrier_weight is not null)),
  constraint carrier_distance_needs_a_carrier check
    (carrier_distance is null or evidence_kind = 'carrier'),
  constraint evidence_lineage_is_whole check
    ((evidence_kind = 'lineage') = (lineage_via is not null and lineage_to_item is not null)),
  constraint evidence_representation_is_whole check
    ((evidence_kind = 'representation') =
     (representation_similarity is not null and representation_space is not null)),
  constraint evidence_adjudication_is_whole check
    ((evidence_kind = 'adjudicated') =
     (adjudicated_by is not null and adjudicated_at is not null)),

  primary key (story_id, item_id)
);

create index story_member_item_idx on public.story_member (item_id);
create index story_member_tier_idx on public.story_member (story_id, evidence_kind);

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
