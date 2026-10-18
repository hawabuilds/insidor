-- 0096_coin_model.sql
--
-- OUR OWN COIN MODEL, THE SAFETY NET BEHIND THE JUDGE: every fit ever made, and every post it scored.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-18: the judge keeps saying no to posts that later get coined — catchphrases,
-- people, news lines — so "build our own small model that catches these as a second chance, without
-- adding cost". At each re-tune tools/lib/coin-model.ts fits a logistic regression over the post's
-- words-and-picture vector and the facts we held when the judge answered (reach for age, its rate,
-- replies, post type, account size, catchphrase hints), tests it on the newest posts it never saw
-- and on the owner's held-out missed posts, chooses a threshold, and writes the fit here, applied
-- or not. The runner scores each post the judge said no to with the latest APPLIED fit, once, and
-- writes the score to internal.coin_model_score. With Policy.judge.coinModel.on the projector lets
-- such a post onto For You when its score is at or over the threshold and every other gate passes;
-- with only `shadow`, the rows are a log of what it would have added and nothing reads them for a
-- feed.
--
-- ── WHY A SCORE IS NOT A JUDGEMENT ───────────────────────────────────────
--
-- The judge's "no" stays the judge's: more than a dozen readers take a post's newest row in
-- internal.post_judgement as its answer, and a second model writing "yes" there would rewrite the
-- re-tune's grading, the missed-post facts and the kind catch-up at once. Here it is its own outcome,
-- with the fit, the threshold of that moment and the answer it was scored behind.
--
-- ── THE FIT ──────────────────────────────────────────────────────────────
--
--   space          the embedding space `vector_weights` are in; a vector of another space scores as none
--   names          the named features, in order, with `means` and `spreads` (standardisation) and `weights`
--   threshold      a post the judge said no to at or over this probability would be let through
--   held_out       the test: the table at several thresholds, the held-out missed posts, the split
--
-- A FIT THAT FAILED ITS GATE IS KEPT, WITH WHY, like the junk filter's (0091). `applied` is set when
-- the row is written and never changed; a newer applied row supersedes an older one.
--
-- ── THE SCORE ────────────────────────────────────────────────────────────
--
-- One row per post, the first score: the facts are those held when the judge answered
-- (`answer_judged_at`), so a later score would be the same number. `would_add` is the score at or
-- over the threshold of that moment; it says nothing about the other gates (the projector applies
-- them, and the shadow report replays them).
--
-- What breaks if changed carelessly: the runner reads the latest applied row's weights and nothing
-- else; the projector reads `would_add` only while the policy is on. `internal`, no grant: a
-- probability is the system's own reasoning and never reaches the app — the owner's list says only
-- which posts came in this way.

create table internal.coin_model (
  id              bigint generated always as identity primary key,
  fitted_at       timestamptz not null,
  space           text not null check (length(space) > 0),
  intercept       double precision not null,
  names           text[] not null,
  means           double precision[] not null,
  spreads         double precision[] not null,
  weights         double precision[] not null,
  vector_weights  double precision[] not null,
  threshold       double precision check (threshold is null or (threshold > 0 and threshold < 1)),
  fit_n           integer not null check (fit_n >= 0),
  held_out        jsonb not null,
  applied         boolean not null,
  applied_at      timestamptz,
  why             text,
  check (applied = (applied_at is not null)),
  check (not applied or threshold is not null),
  check (cardinality(names) = cardinality(means) and cardinality(names) = cardinality(spreads) and cardinality(names) = cardinality(weights))
);

create index coin_model_applied_idx on internal.coin_model (applied_at desc) where applied;

comment on table internal.coin_model is
  'Our own coin model (the safety net behind the judge): one row per fit, applied or not, with its held-out test. Never shown.';

create table internal.coin_model_score (
  item_id           text primary key references public.item (item_id) on delete cascade,
  fit_id            bigint not null references internal.coin_model (id),
  probability       double precision not null check (probability >= 0 and probability <= 1),
  threshold         double precision not null check (threshold > 0 and threshold < 1),
  would_add         boolean not null,
  answer_judged_at  timestamptz not null,
  scored_at         timestamptz not null,
  mode              text not null check (mode in ('shadow', 'live'))
);

create index coin_model_score_scored_at_idx on internal.coin_model_score (scored_at);
create index coin_model_score_add_idx on internal.coin_model_score (item_id) where would_add;

comment on table internal.coin_model_score is
  'Each post the judge said no to, scored once by the coin model: what the safety net would let through. Never shown.';
