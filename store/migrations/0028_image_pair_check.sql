-- 0028_image_pair_check.sql
--
-- WHAT THE JUDGE SAID ABOUT A BORDERLINE PAIR OF PICTURES, SO IT IS ASKED ONCE.
--
-- When a new post's picture is only borderline-similar to a story's picture (between the two
-- bars in Policy.group.image), GROUP asks the judge "is the main subject the same?" and only
-- "yes" counts. The answer is kept per pair of image URLs and per prompt version: the same
-- two pictures are never paid for twice, and a reworded prompt asks again. The table is also
-- the daily count the per-day cap is enforced against.
--
-- `uri_a < uri_b` so a pair has one spelling whichever post arrived first. `internal`, no
-- grant: an answer about two pictures is our reasoning, never shown.

create table internal.image_pair_check (
  uri_a       text not null,
  uri_b       text not null,
  prompt_id   text not null check (length(prompt_id) > 0),
  answer      text not null check (answer in ('yes', 'no', 'unsure')),
  judge_id    text not null check (length(judge_id) > 0),
  checked_at  timestamptz not null,
  cost_usd    numeric(12, 8) not null check (cost_usd >= 0),
  primary key (uri_a, uri_b, prompt_id),
  constraint pair_is_ordered check (uri_a < uri_b)
);

create index image_pair_check_day_idx on internal.image_pair_check (checked_at);

comment on table internal.image_pair_check is
  'The judge''s yes / no / unsure about whether two pictures show the same subject, once per pair and prompt version. Counted per day against Policy.group.image.pairChecksPerDay.';
