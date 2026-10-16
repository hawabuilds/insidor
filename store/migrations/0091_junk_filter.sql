-- 0091_junk_filter.sql
--
-- THE JUNK FILTER BEFORE THE POST JUDGE: every fit ever made, and every post it kept from the judge.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-16: "train a small classifier on my labels using the post vectors; posts it's
-- confident are junk skip the judge; tune it so it never drops gold or missed posts." At each
-- re-tune (08:00 and 20:00 London) tools/lib/junk-filter.ts fits a logistic regression over each
-- labelled post's words-and-picture vector (the precedents' own, 0069/0074), tests it on held-out
-- folds, chooses the junk-probability threshold at which no held-out hand gold or missed post would
-- be dropped, and writes the fit to internal.junk_filter, applied or not. While
-- Policy.judge.junkFilter.on, the runner scores each post about to be judged with the latest
-- APPLIED fit (core `junkProbability`) and does not ask the judge about one at or over its
-- threshold: that post gets a row in internal.junk_skip.
--
-- ── WHY A SKIP IS NOT A JUDGEMENT ────────────────────────────────────────
--
-- A skipped post was never asked. Writing "coinable false" for it in internal.post_judgement would
-- be a judge's "no" nobody gave, read by more than a dozen readers that take a post's newest row
-- there (the projector, the missed-post facts, the re-tune's grading) as the judge's own. Here it
-- is its own outcome, with the fit and how sure it was: the post has no answer, every feed reader
-- sees "never judged" and keeps it off the feed, and the runner's queue leaves it out while the
-- filter is on. Switched off, the queue no longer reads this table and a skipped post still inside
-- the feed's window is judged like any other.
--
-- ── THE FIT ──────────────────────────────────────────────────────────────
--
--   space       the embedding space the weights are in: a vector of another space is never scored
--   intercept   the fit's intercept; `weights` one per vector dimension, in order
--   threshold   a post at or over this probability of junk is not asked; null when the held-out
--               test found none under 1 that keeps every hand gold and missed post
--   held_out    the test: each label group's dropped-of-tested at the threshold and at the table's
--               thresholds, and the share of the day's judged posts it would have skipped
--
-- A FIT THAT FAILED IS KEPT, WITH WHY, like the order model's (0065). `applied` is set when the row
-- is written and never changed; a newer applied row supersedes an older one. An applied row always
-- has a threshold; the CHECK keeps the three together.
--
-- What breaks if changed carelessly: the runner reads `weights`, `intercept`, `threshold` and
-- `space` of the latest applied row and nothing else. `internal`, no grant: a probability of junk
-- is the system's own reasoning and never reaches the app.

create table internal.junk_filter (
  id          bigint generated always as identity primary key,
  fitted_at   timestamptz not null,
  space       text not null check (length(space) > 0),
  intercept   double precision not null,
  weights     double precision[] not null check (cardinality(weights) > 0),
  threshold   double precision check (threshold is null or (threshold > 0 and threshold < 1)),
  fit_n       integer not null check (fit_n >= 0),
  held_out    jsonb not null,
  applied     boolean not null,
  applied_at  timestamptz,
  why         text,
  check (applied = (applied_at is not null)),
  check (not applied or threshold is not null)
);

create index junk_filter_applied_idx on internal.junk_filter (space, applied_at desc) where applied;

comment on table internal.junk_filter is
  'The junk filter before the post judge: one row per fit, applied or not, with its held-out test. Never shown.';

-- One row per post, the first skip: a post the filter kept from the judge is not offered again
-- while the filter is on, so it is never skipped twice.
create table internal.junk_skip (
  item_id      text primary key references public.item (item_id) on delete cascade,
  fit_id       bigint not null references internal.junk_filter (id),
  probability  double precision not null check (probability >= 0 and probability <= 1),
  skipped_at   timestamptz not null
);

create index junk_skip_skipped_at_idx on internal.junk_skip (skipped_at);

comment on table internal.junk_skip is
  'Posts the junk filter kept from the post judge: not asked, never a "no". Never shown.';
