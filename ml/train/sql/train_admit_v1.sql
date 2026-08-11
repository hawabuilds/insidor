-- The training set for ADMIT, v1.
--
-- THIS FILE IS THE TRAINING SET. Not a step towards it — the join below IS it.
-- Its sha256 is stored in the model registry row, so "what was this trained on"
-- is answerable from a row rather than from someone's memory of a notebook.
--
-- Committed, versioned, never edited in place. A change to the population, the
-- label or the weights is a NEW numbered file (train_admit_v2.sql), because a
-- silently edited query makes every model trained before the edit unreproducible.
--
-- Parameters:
--   $1  window start  (timestamptz)  — decisions decided at or after this
--   $2  window end    (timestamptz)  — decisions decided before this
--   $3  purge cutoff  (timestamptz)  — labels must have RESOLVED before this
--
-- Python never sees a raw post, never touches a counter, never calls a platform.
-- It sees this result set: a table of frozen numbers and a column of labels.

select
  d.id                                   as decision_id,
  d.decided_at,
  d.subject_kind,
  d.subject_id,
  d.horizon_s,

  -- ★ EXACTLY what the decider saw, frozen before the outcome existed. The
  --   trainer cannot recompute a feature, which is what dissolves train/serve
  --   skew rather than managing it.
  d.features,
  d.feature_set,
  d.feature_hash,

  d.policy_hash,
  d.decider,
  d.propensity,
  d.explore,
  d.explore_arm,
  d.log_sample_rate,

  l.y,
  l.value                                as label_value,
  l.label_name,
  l.label_version,
  l.window_days                          as label_window_days,
  l.population,
  l.source                               as label_source,
  l.origin_ts                            as label_origin_ts,
  l.resolves_at                          as label_resolves_at,

  -- Three weights, three different corrections. Kept separate so a report can
  -- say which one moved a number.
  --   ips      — undoes the bias of having chosen the action we logged. Valid
  --              ONLY on the explore lane; 1.0 elsewhere by construction.
  --   recency  — 21-day half-life. The market changes regime constantly.
  --   log      — undoes downsampling. A downsample you forgot to record is a
  --              biased training set, so log_sample_rate is a column, not a
  --              number in a script.
  case when d.explore then 1.0 / d.propensity else 1.0 end          as ips_weight,
  power(0.5, extract(epoch from ($2 - d.decided_at)) / (21 * 86400)) as recency_weight,
  1.0 / d.log_sample_rate                                           as log_weight,

  case when d.explore_arm = 'holdout' then 'holdout'
       when d.explore                 then 'epsilon'
       else                                'exploit' end             as lane

from internal.decisions d
join internal.labels l
  on  l.subject_kind  = d.subject_kind
  and l.subject_id    = d.subject_id
  and l.label_name    = 'peak_multiple'
  and l.label_version = 'v1'

where d.stage        = 'admit'
  and d.shadow_of   is null           -- a challenger's shadow row is not an action
  and d.applied_at is not null        -- the side effect actually happened
  and d.decided_at >= $1
  and d.decided_at <  $2

  -- 'pending' is NOT a negative. With a six-day median to peak the pending
  -- population is large relative to the resolved one for months, and coercing it
  -- is the classic error that would be severe here.
  -- 'censored' is excluded but counted elsewhere: a rising censoring rate is the
  -- earliest sign the label pipeline is rotting.
  and l.status       = 'resolved'

  -- ★ THE PURGE. A training example whose label window covers the test period
  --   shares outcome information with it. Without this line a walk-forward split
  --   still leaks, which is the subtler cousin of a random split.
  and l.resolves_at <  $3

  -- ★ THE ANTI-CIRCULARITY CLAUSE. The coin must not have existed before the
  --   decision. 10 of 62 rows in the voided backtest had an "origin" post
  --   published after the coin already existed. In SQL, once, forever.
  and l.origin_ts   >= d.decided_at

order by d.decided_at;
