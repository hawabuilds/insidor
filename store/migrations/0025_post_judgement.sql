-- 0025_post_judgement.sql
--
-- HOW A POST WAS FOUND, AND WHAT THE JUDGE SAID ABOUT IT ALONE.
--
-- The For You feed shows single posts, and the earlier build's rule for which ones is two
-- facts: the post came in through the catch-all search's approval floor, and the judge,
-- shown that post alone, scored it at or above the bar in Policy.qualify.minJudgeConfidence.
-- Neither fact had anywhere to live: an item did not record which search found it, and
-- internal.judgement is keyed by story.
--
-- Both tables are `internal`, with no grant: which search found a post, and what our judge
-- made of it, are our own reasoning. The feed shows the post; it never shows these.

/* ── which catch-all lane found a post ───────────────────────────────────────
   Written when a catch-all page is stored. A post found by a keyword search has no row,
   and that absence is what keeps it off the feed: only the floor-filtered search speaks
   for "this is moving whatever it is about". The first lane to find a post keeps it. */
create table internal.item_found_by (
  item_id   text primary key references public.item (item_id) on delete cascade,
  lane      text not null check (lane in ('all', 'media')),
  found_at  timestamptz not null
);

/* ── the judge's answer about one post ───────────────────────────────────────
   The same columns as internal.judgement, keyed by item, so one mapping reads both. A post
   is judged once; an answer is never edited (append-only, as 0022), and a post with no row
   has no score — it waits, and is never shown as if it had passed. */
create table internal.post_judgement (
  id               bigint generated always as identity primary key,
  item_id          text not null references public.item (item_id) on delete cascade,
  judged_at        timestamptz not null,
  member_count     integer not null check (member_count = 1),
  judge_id         text not null check (length(judge_id) > 0),
  prompt_id        text not null check (length(prompt_id) > 0),
  looked_at        text not null check (looked_at in ('text', 'videoFrame')),
  coinable         boolean not null,
  confidence       double precision not null check (confidence >= 0 and confidence <= 1),
  proposed_name    text,
  alternate_names  jsonb not null check (jsonb_typeof(alternate_names) = 'array'),
  subject_spans    jsonb not null check (jsonb_typeof(subject_spans) = 'array'),
  cost_usd         numeric(12, 8) not null check (cost_usd >= 0),
  recorded_at      timestamptz not null default now()
);

create index post_judgement_item_idx on internal.post_judgement (item_id, judged_at desc);

create trigger post_judgement_append_only
  before update or delete on internal.post_judgement
  for each row execute function internal.forbid_mutation();

comment on table internal.item_found_by is
  'Which catch-all search lane first found a post. Only these posts are scored alone and can reach the For You feed.';
comment on table internal.post_judgement is
  'Every answer the judge gave about a single post, append-only. One per post; a post with none has no score and waits.';
