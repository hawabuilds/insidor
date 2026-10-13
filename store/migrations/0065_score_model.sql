-- 0065_score_model.sql
--
-- THE FOR YOU ORDER MODEL, ONE ROW PER FIT EVER MADE.
--
-- At each re-tune (08:00 and 20:00 London) tools/lib/score-model.ts fits a small logistic
-- regression over each post's separate signals (core `postSignals`: the judge's answer and belief,
-- the picture match, reach, growth, crypto attention…) on every label so far, tests it on posts it
-- was not fitted on, and writes the fit here, applied or not. The projector orders For You by the
-- latest APPLIED fit (core `postRankScore`) and, when Policy.rising.scorePassBar is set, holds back
-- a post under it.
--
-- ★ A FIT THAT FAILED THE GATE IS KEPT, WITH WHY, like the judge's examples (0056): the owner reads
-- why the order did not change. `applied` is set when the row is written and never changed; a newer
-- applied row supersedes an older one.
--
-- `terms` is the fit itself: [{signal, kind: 'value'|'missing', centre, spread, weight}], each value
-- standardised by its centre and spread so the weights compare across signals. `held_out` carries
-- the test's numbers (each group as passed-of-tested at the bar in force, and the ordering check).
--
-- What breaks if changed carelessly: the projector reads `terms` and `intercept` and nothing else. A
-- row written applied with no `applied_at` would never be read; the CHECK keeps the two together.
--
-- A post feature's NUMBER lives here and never reaches the app: `internal`, no grant. Also widens
-- feed_rejection's reasons by one, so a post the bar holds back says so; replaced, never loosened.

create table internal.score_model (
  id          bigint generated always as identity primary key,
  fitted_at   timestamptz not null,
  -- The signal names the fit was offered, in order, and how many labelled posts it was fitted on.
  features    text[] not null,
  intercept   double precision not null,
  terms       jsonb not null,
  fit_n       integer not null check (fit_n >= 0),
  held_out    jsonb not null,
  applied     boolean not null,
  applied_at  timestamptz,
  why         text,
  check (applied = (applied_at is not null))
);

create index score_model_applied_idx on internal.score_model (applied_at desc) where applied;

comment on table internal.score_model is
  'The For You order model: one row per fit, applied or not, with its held-out test. Never shown.';

alter table public.feed_rejection drop constraint feed_rejection_reason_check;
alter table public.feed_rejection add constraint feed_rejection_reason_check check (reason in (
  'not_scored', 'not_memeable', 'judge_unsure', 'name_test',
  'under_reach_bar', 'reach_unread', 'too_few_passing_posts', 'owner_not_meme', 'under_score_bar'));
