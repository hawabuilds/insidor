-- 0007_labels.sql
--
-- ★ OUTCOMES. Settled days after the decision that is graded by them.
--
-- Every row states the population it was computed over, because a rate without its
-- denominator is not a fact. The previous backtest reported a claim about
-- coinability in general while its population was graduated coins — about 107 a day
-- against roughly 30,000 mints, well under half a percent. Nobody lied; the
-- denominator simply was not written next to the number. `population` is NOT NULL
-- with NO DEFAULT so that omitting it is a failed INSERT rather than a habit.

create table internal.labels (
  subject_kind  text not null check (subject_kind in ('item', 'story', 'pair', 'candidate')),
  subject_id    text not null,
  label_name    text not null,      -- 'peak_multiple' | 'reproducers_6h'
  label_version text not null,
  window_days   integer not null check (window_days > 0),

  origin_ts   timestamptz not null,   -- the clock the window measures from
  resolves_at timestamptz not null,   -- origin_ts + window_days

  -- FOUR STATES, and everyone gets the third and fourth wrong.
  --   resolved  the window closed and we watched all of it
  --   pending   now() < resolves_at. EXCLUDED from training, NEVER coerced to
  --             negative. With a six-day median to peak, the pending population is
  --             large relative to the resolved one for the first several months, so
  --             this error would not be a rounding issue — it would be the dataset.
  --   censored  the mint stream had a gap over the window, or the post was deleted,
  --             or the counter went stale. Excluded from training but COUNTED: a
  --             rising censoring rate is the earliest sign the pipeline is rotting.
  --   unresolvable  the subject can never be graded (deleted at source, no origin).
  status text not null check (status in ('pending', 'resolved', 'censored', 'unresolvable')),

  value         double precision,
  y             boolean,            -- thresholded; null unless resolved
  censor_reason text,

  -- ★ the denominator, made impossible to omit
  population text not null check (length(trim(population)) > 0),
  source     text not null,         -- 'dune:peak_multiple_v1@<git sha>' — a rerunnable recipe

  -- When the FIRST matching evidence arrived, recorded even while the row is still
  -- pending. One column today, unrecoverable tomorrow: it is what yields the
  -- empirical delay distribution P(delay <= t), and in six months that is what makes
  -- the delayed-feedback correction possible — pending rows admitted as negatives
  -- weighted by 1 / P(delay <= elapsed).
  first_signal_at timestamptz,
  computed_at     timestamptz,

  constraint resolved_has_a_verdict check
    (status <> 'resolved' or y is not null),
  constraint only_resolved_is_thresholded check
    (status = 'resolved' or y is null),
  constraint censored_states_why check
    (status <> 'censored' or censor_reason is not null),
  constraint window_closes_after_origin check (resolves_at > origin_ts),

  primary key (subject_kind, subject_id, label_name, label_version, window_days)
);

create index labels_pending_idx on internal.labels (status, resolves_at)
  where status = 'pending';
create index labels_name_idx on internal.labels (label_name, status, origin_ts desc);

/* ── the training view — the artefact everything else exists to produce ───
   Only rows that are safe to learn from. Four of the five WHERE clauses are
   exclusions someone previously forgot. */

create or replace view internal.train_admit_v1 as
select
  d.id as decision_id,
  d.decided_at,
  d.horizon_s,
  d.subject_id,
  d.features,
  d.feature_set,
  d.policy_hash,
  d.decider,
  d.propensity,
  d.explore,
  d.explore_arm,
  l.y,
  l.value as label_value,
  l.label_version,

  -- Inverse propensity, valid only over the explore lanes; the exploit lane's 1.0
  -- makes this a no-op there, which is the correct behaviour rather than a bug.
  case when d.explore then 1.0 / d.propensity else 1.0 end          as ips_weight,
  power(0.5, extract(epoch from (now() - d.decided_at)) / (21 * 86400)) as recency_weight,
  1.0 / d.log_sample_rate                                            as log_weight
from internal.decisions d
join internal.labels l
  on  l.subject_kind = d.subject_kind
  and l.subject_id   = d.subject_id
  and l.label_name   = 'peak_multiple'
where d.stage = 'admit'
  and d.shadow_of is null            -- challengers changed nothing; they are not examples
  and d.applied_at is not null       -- the side effect actually happened
  and l.status = 'resolved'
  and l.resolves_at < now()          -- no open windows
  -- ★ THE ANTI-CIRCULARITY CLAUSE. The last backtest was voided because 10 of its
  -- 62 rows had an "origin" post published AFTER the coin already existed — the
  -- post was a reaction to the coin, and the model was learning to detect its own
  -- outcome. One line of SQL, once, forever.
  and l.origin_ts >= d.decided_at;

comment on view internal.train_admit_v1 is
  'Rows that are safe to learn from. Pending is never a negative; open windows never appear.';
