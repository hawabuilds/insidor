-- 0022_judgement.sql
--
-- EVERY JUDGEMENT THE JUDGE GAVE, SO A STORY IS ASKED ONCE AND A RESTART DOES NOT ASK AGAIN.
--
-- ── ★ WHY THIS TABLE EXISTS ─────────────────────────────────────────────────
--
-- The judge is the only per-subject spend in the pipeline. Without a record of what it
-- already answered, the runner would ask about every promoted story on every QUALIFY pass,
-- and every restart would start the bill again from nothing. With it, a story is judged
-- once, and asked again only when its posts have grown enough to change the answer
-- (`Policy.judge.rejudgeGrowth`, read against `member_count` here).
--
-- It is also the replay record: QUALIFY reads the judgement as data, so a past decision
-- can be re-run with the same judgement and no network, which is the whole reason the
-- stage is shaped the way it is.
--
-- ── ★ WHAT IS NOT HERE ──────────────────────────────────────────────────────
--
-- Only answers. A call that was unavailable, refused for money, or priced in a dry run
-- writes no row: none of those is a judgement, and a row for them would make "we asked"
-- and "we got an answer" the same fact. Those absences are recorded where they belong, as
-- QUALIFY's abstain reasons (Q11, Q12, Q13) on the decision row.
--
-- And no prose. The judge's reasoning is never stored inline (contracts/src/judgement.ts).
--
-- ── ★ WHY `internal` ─────────────────────────────────────────────────────────
--
-- A judgement is our own reasoning, not a fact about the world, and the app role has no
-- USAGE on this schema. There is no grant line below, on purpose.

create table internal.judgement (
  id               bigint generated always as identity primary key,
  story_id         text not null check (length(story_id) > 0),

  -- When the judge answered, as the caller recorded it. Never now(): a replay must
  -- produce the same row.
  judged_at        timestamptz not null,

  -- How many members the story had when it was judged. What the re-judge rule compares
  -- the story's current size against.
  member_count     integer not null check (member_count >= 0),

  -- Which judge and which prompt set answered. A prompt edit or a model change changes
  -- these, so answers from before and after stay distinguishable.
  judge_id         text not null check (length(judge_id) > 0),
  prompt_id        text not null check (length(prompt_id) > 0),

  -- What the judge was shown, which decides QUALIFY's confidence bar. The list matches
  -- JUDGE_EVIDENCE in contracts/src/judgement.ts; store/src/migrations.test.ts asserts it.
  looked_at        text not null check (looked_at in ('text', 'videoFrame')),

  coinable         boolean not null,
  confidence       double precision not null check (confidence >= 0 and confidence <= 1),
  proposed_name    text,
  alternate_names  jsonb not null check (jsonb_typeof(alternate_names) = 'array'),
  subject_spans    jsonb not null check (jsonb_typeof(subject_spans) = 'array'),

  -- This story's share of what its batch cost.
  cost_usd         numeric(12, 8) not null check (cost_usd >= 0),

  recorded_at      timestamptz not null default now()
);

create index judgement_story_idx on internal.judgement (story_id, judged_at desc);

comment on table internal.judgement is
  'Every answer the judge gave, append-only. Read so a story is judged once and a restart does not ask again; asked again only when its member count has grown by Policy.judge.rejudgeGrowth. Absences (unavailable, budget, dry run) write no row.';

/* Append-only, by the trigger from 0001. A judgement is evidence a decision was made
   from; editing it would make a past decision unreplayable. A newer answer is a new row. */
create trigger judgement_append_only
  before update or delete on internal.judgement
  for each row execute function internal.forbid_mutation();
