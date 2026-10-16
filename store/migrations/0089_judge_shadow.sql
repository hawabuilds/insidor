-- 0089_judge_shadow.sql
--
-- THE OTHER JUDGE'S ANSWERS, KEPT WHERE NOTHING ON THE FEED CAN READ THEM.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-16: "shadow run from now until 20:00: the open model judges every live post
-- alongside the live judge (the live judge stays live). Show me where they disagree." Every batch
-- the live judge answers is sent, unchanged, to the judge that did not answer it
-- (Policy.judge.shadow, services/runner/src/judge-shadow.ts), and each pair of answers is one row
-- here, read by tools/judge-shadow-report.ts.
--
-- ── WHY NOT internal.post_judgement WITH A MARKER ────────────────────────
--
-- Because more than a dozen readers take a post's NEWEST row there without asking which judge wrote
-- it: the projector's narrative rules (narrative-rules.ts), the tracking read (store items.ts), the
-- missed-post facts, the coin-name lookups. A shadow answer lands seconds after the live one and
-- would become the post's answer on For You. A separate table makes "never used by the feed" a
-- fact of the schema rather than a filter every reader has to remember.
--
-- ── ONE ROW, BOTH ANSWERS ────────────────────────────────────────────────
--
-- The live answer is copied in beside the shadow's, as it was when both were given, with each
-- call's seconds per post and dollars per post. The comparison then never depends on a later
-- re-score having replaced the live answer in post_judgement. A shadow that gave no answer has
-- null shadow fields and its reason in `shadow_detail`: an outage is recorded as missing, never as
-- a "no". Append-only, like every other answer table.
--
-- What breaks if changed carelessly: pointing a feed reader at this table. Its answers were never
-- held to the feed's rules, and the shadow is capped per day, so a post here may have no live
-- counterpart worth trusting the next day.

create table internal.judge_shadow (
  id                  bigint generated always as identity primary key,
  item_id             text not null references public.item (item_id) on delete cascade,
  asked_at            timestamptz not null,
  -- Which question both were asked. Only the post question is shadowed today.
  question            text not null check (question in ('post', 'kind')),
  live_judge_id       text not null check (length(live_judge_id) > 0),
  live_prompt_id      text not null check (length(live_prompt_id) > 0),
  live_coinable       boolean not null,
  live_confidence     double precision not null check (live_confidence >= 0 and live_confidence <= 1),
  live_looked_at      text not null check (live_looked_at in ('text', 'picture', 'videoFrame')),
  live_name           text,
  live_cost_usd       numeric(12, 8) not null check (live_cost_usd >= 0),
  -- Seconds the live call took over the posts it carried; null when not timed.
  live_s_per_post     double precision check (live_s_per_post is null or live_s_per_post >= 0),
  shadow_judge_id     text,
  shadow_prompt_id    text,
  shadow_coinable     boolean,
  shadow_confidence   double precision check (shadow_confidence is null or (shadow_confidence >= 0 and shadow_confidence <= 1)),
  shadow_looked_at    text check (shadow_looked_at is null or shadow_looked_at in ('text', 'picture', 'videoFrame')),
  shadow_name         text,
  shadow_cost_usd     numeric(12, 8) not null default 0 check (shadow_cost_usd >= 0),
  shadow_s_per_post   double precision check (shadow_s_per_post is null or shadow_s_per_post >= 0),
  -- Why the shadow gave no answer; null when it answered.
  shadow_detail       text,
  recorded_at         timestamptz not null default now(),
  check ((shadow_judge_id is null) = (shadow_coinable is null))
);

create index judge_shadow_asked_idx on internal.judge_shadow (asked_at desc);

create trigger judge_shadow_append_only
  before update or delete on internal.judge_shadow
  for each row execute function internal.forbid_mutation();

comment on table internal.judge_shadow is
  'The judge that did not answer a live batch, asked the same batch: both answers per post, never read by the feed (Policy.judge.shadow).';
