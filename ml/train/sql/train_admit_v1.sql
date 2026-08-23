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
-- Parameters, NAMED rather than positional. psycopg binds the percent-name form
-- below, not the `$n` form this file shipped with — which could never have
-- executed through build_dataset.py, and is how it survived unnoticed until the
-- first run. Named also because the window end is needed TWICE — once as a bound,
-- once inside the recency half-life — and a repeated positional parameter breaks
-- silently the first time someone reorders the argument tuple.
--
-- ★ AND DO NOT WRITE AN EXAMPLE PLACEHOLDER IN THIS COMMENT. psycopg scans the
-- whole statement including comments, so a specimen name in prose becomes a
-- parameter the caller must supply. That cost a run.
--   %(window_start)s  (timestamptz)  — decisions decided at or after this
--   %(window_end)s    (timestamptz)  — decisions decided before this
--   %(purge_cutoff)s  (timestamptz)  — labels must have RESOLVED before this
--
-- Python never sees a raw post, never touches a counter, never calls a platform.
-- It sees this result set: a table of frozen numbers and a column of labels.
--
-- ★ WHY THIS FILE WAS EDITED IN PLACE ONCE, AGAINST ITS OWN RULE ABOVE.
--
-- The rule exists to keep a TRAINED model reproducible: if a query changes under
-- a model whose registry row cites its sha256, that model can never be rebuilt.
-- When the join below was corrected there was no such model — internal.labels
-- held no resolved row, no dataset.parquet had ever been built from this file,
-- and there is no model registry table in the database at all. Nothing was made
-- unreproducible, and the alternative — a train_admit_v2.sql beside a v1 that is
-- known to silently discard every corrected label — leaves the broken one in the
-- tree for someone to pick.
--
-- THE EXEMPTION EXPIRES THE MOMENT A REGISTRY ROW CITES THIS FILE'S SHA. After
-- that, the rule at the top is the rule: a new numbered file, never an edit.

with latest_label as (
  -- ★ THE LATEST REVISION OF THE DEFINITION, NOT THE STRING 'v1'.
  --
  -- The labeller never edits a settled row. When our own evidence improves — a
  -- coverage gap backfilled, a market series that arrived late — it APPENDS the
  -- new answer at the next revision, spelled `v1.r2`, `v1.r3` by
  -- contracts/src/label.ts. This query used to join `label_version = 'v1'`, so
  -- every one of those corrections was invisible: a subject censored in March and
  -- resolved in April joined its March row, was dropped by `status = 'resolved'`,
  -- and never entered training at all. Measured on a constructed case — censor,
  -- backfill, re-grade — the corrected row was dropped and the census reported the
  -- subject as censored: half the population unobservable, over a population with
  -- none of it unobservable.
  --
  -- (And no per-cent sign anywhere in this comment, for the reason the header
  -- gives about placeholders: psycopg scans the whole statement, comments
  -- included, and a bare per-cent is an incomplete placeholder that stops the
  -- query from executing at all. That cost a run here too.)
  --
  -- The consequence was not only lost rows. `census_admit_v1.sql` counts the same
  -- stale row, so `censoredRate` climbs with every correction the labeller makes,
  -- toward the ceiling at which build_dataset.py REFUSES to build — the pipeline
  -- would have been throttled by its own repairs.
  --
  -- `distinct on` and not a window function because the ordering IS the rule and
  -- this way it is written once. The revision regex is deliberately strict: a
  -- version this file did not write ('v1.rubbish') is a definition we do not
  -- recognise, not a revision, exactly as `parseLabelVersion` treats it. Widening
  -- it would fold a foreign definition into this measurement's revision chain.
  select distinct on (subject_kind, subject_id, label_name, window_days) *
    from internal.labels
   where label_name = 'peak_multiple'
     and (label_version = 'v1' or label_version ~ '^v1\.r[1-9][0-9]*$')
   order by subject_kind, subject_id, label_name, window_days,
            case when label_version = 'v1' then 1
                 else (substring(label_version from '^v1\.r([0-9]+)$'))::integer
            end desc
)

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
  power(0.5, extract(epoch from (%(window_end)s - d.decided_at)) / (21 * 86400)) as recency_weight,
  1.0 / d.log_sample_rate                                           as log_weight,

  case when d.explore_arm = 'holdout' then 'holdout'
       when d.explore                 then 'epsilon'
       else                                'exploit' end             as lane

from internal.decisions d
join latest_label l
  on  l.subject_kind  = d.subject_kind
  and l.subject_id    = d.subject_id

where d.stage        = 'admit'
  and d.shadow_of   is null           -- a challenger's shadow row is not an action
  and d.applied_at is not null        -- the side effect actually happened
  and d.decided_at >= %(window_start)s
  and d.decided_at <  %(window_end)s

  -- 'pending' is NOT a negative. With a six-day median to peak the pending
  -- population is large relative to the resolved one for months, and coercing it
  -- is the classic error that would be severe here.
  -- 'censored' is excluded but counted elsewhere: a rising censoring rate is the
  -- earliest sign the label pipeline is rotting. "Elsewhere" is a real file —
  -- census_admit_v1.sql, run by build_dataset.py on every build over exactly this
  -- population, whose counts land in manifest.json under `labelCensus`. Until it
  -- existed this comment described an intention.
  and l.status       = 'resolved'

  -- ★ THE PURGE. A training example whose label window covers the test period
  --   shares outcome information with it. Without this line a walk-forward split
  --   still leaks, which is the subtler cousin of a random split.
  and l.resolves_at <  %(purge_cutoff)s

  -- ★ THE ANTI-CIRCULARITY CLAUSE. The coin must not have existed before the
  --   decision. 10 of 62 rows in the voided backtest had an "origin" post
  --   published after the coin already existed. In SQL, once, forever.
  and l.origin_ts   >= d.decided_at

order by d.decided_at;
