-- 0049_feed_rejection.sql
--
-- WHAT THE FEEDS HID, AND WHY — kept, never deleted, so it can be read back as "no" examples.
--
-- The projector holds every post on For You and Popular, and every narrative on the board, to the
-- owner's rules: scored and passed (the judge's answer, the confidence bar, the name test), the
-- reach bars, and for a narrative enough passing posts. When something that was showing fails, or
-- a narrative's post is dropped from its list, a row here says what and why. Nothing is removed
-- from public.item or public.story: hiding is the projection's choice, and the post or story stays
-- as evidence. A tuning run reads these rows as the feed's own rejected examples.
--
-- One row per subject, replaced when the reason changes; `first_rejected_at` keeps when it first
-- left. `subject_kind` says whether `subject_id` is a post (item id) or a narrative (story id).
--
-- `public` because the projector writes it under the service role, which may write public and only
-- read internal; NOT granted to the app role — a reason the system rejected something is its own
-- reasoning, and that never goes on screen.

create table public.feed_rejection (
  subject_kind       text not null check (subject_kind in ('post', 'narrative')),
  subject_id         text not null check (length(subject_id) > 0),
  reason             text not null check (reason in (
                       'not_scored', 'not_memeable', 'judge_unsure', 'name_test',
                       'under_reach_bar', 'reach_unread', 'too_few_passing_posts')),
  detail             text,
  first_rejected_at  timestamptz not null default now(),
  rejected_at        timestamptz not null default now(),
  primary key (subject_kind, subject_id)
);

create index feed_rejection_reason_idx on public.feed_rejection (reason, rejected_at desc);

comment on table public.feed_rejection is
  'Posts and narratives the feeds hid, with why. Kept as "no" examples; never granted to the app.';
