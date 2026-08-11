-- 0006_decisions.sql
--
-- ★ THE DECISION LOG. The one table in this system that cannot be reconstructed
-- later, and therefore the one that has to be right on day one.
--
-- The problem it solves, in one sentence: the decision happens in minutes and the
-- answer arrives in days, so anything not written down at the moment of the
-- decision is gone. Post-to-mint is a median 3.8 minutes; post-to-peak is about six
-- days. That is a gap of roughly 2,000×, and it is exactly the interval in which
-- the world changes underneath any feature you might try to recompute afterwards.
--
-- This project has already lost two studies to recomputation. A backtest's three
-- "strongest" features were read by a human opening the origin post's replies
-- MONTHS after the coin ran — and a coin that 10×'d gets shilled in its origin
-- post's replies for months, so "crypto noticed it" was a consequence of the
-- outcome dressed as a predictor. Freezing the feature vector before the outcome
-- exists does not manage that failure. It dissolves it.

create table internal.decisions (
  id           bigserial,
  decided_at   timestamptz not null default now(),

  stage        text not null check (stage in
                 ('admit', 'track', 'detect', 'group', 'qualify', 'resolve', 'rank')),
  subject_kind text not null check (subject_kind in ('item', 'story', 'pair', 'candidate')),
  subject_id   text not null,      -- 'x:1823…' | 'story_7f3a' | 'story_7f3a|solana:9xQe…'

  -- THREE SEPARATE CLOCKS. Conflating any two is how lookahead comes back.
  --   feature_asof   the newest input datum the decider was allowed to see
  --   decided_at     when we chose
  --   subject_origin when the thing itself began (post time, mint block time)
  feature_asof   timestamptz not null,
  subject_origin timestamptz,
  horizon_s      integer,          -- decided_at − subject_origin, materialised for querying

  verdict text not null check (verdict in ('pass', 'hold', 'drop', 'abstain')),
  -- From a closed vocabulary, NEVER null, including on a pass. Free text here would
  -- make every recall number ungroupable within a month.
  reason  text not null,
  score   double precision,        -- null when a rule decided; a number when a model did

  -- EXACTLY what the decider saw. jsonb rather than typed columns on purpose: the
  -- feature set will change weekly for the first year, and a schema migration per
  -- feature change guarantees the feature set stops evolving. Promote three to five
  -- to generated STORED columns once they show up in WHERE clauses; leave the rest.
  features     jsonb not null,
  feature_set  text not null,      -- 'story.qualify.v1'
  feature_hash text not null,      -- sha256 of the sorted key list

  -- The bar it was judged against. Without this, a config change makes every past
  -- decision unauditable — which is the state the previous build is in today,
  -- because its threshold was computed, returned, logged and never persisted.
  policy_hash text not null,
  -- 'rule:qualify@1' today, 'gbdt:qualify@2026-11-02' later. The log does not care
  -- what decided; the rows join to the same labels through the same subject_id.
  -- That is why the learning substrate works before any model exists.
  decider     text not null,

  -- (0,1]. 1.0 for a deterministic rule. A deterministic policy has propensity 1
  -- for the action it took and 0 for every other, which makes counterfactual
  -- estimates undefined — no cleverness recovers this after the fact, so the
  -- randomness has to be injected at decision time and recorded here.
  propensity      double precision not null check (propensity > 0 and propensity <= 1),
  explore         boolean not null default false,
  -- ★ 'holdout' is the held-back slot: chosen before every gate, tracked and
  -- label-joined, and never rendered. It is the only measurement of what the gates
  -- MISS, and its absence is a permanent hole in the record rather than a pause.
  explore_arm     text check (explore_arm in ('epsilon', 'holdout')),
  -- A downsample you forgot to record is a biased training set. Training reweights
  -- by 1/log_sample_rate, so the number has to be on the row, not in a runbook.
  log_sample_rate double precision not null default 1.0
                    check (log_sample_rate > 0 and log_sample_rate <= 1),

  -- A challenger runs on the SAME frozen feature vector immediately after the
  -- champion, writes a second row and changes nothing. Champion-versus-challenger
  -- becomes a query instead of a deploy. Not a foreign key: the parent is
  -- partitioned, so the reference carries its partition key alongside it.
  shadow_of    bigint,
  shadow_of_at timestamptz,

  cost_usd   numeric(12, 8) not null default 0,
  -- Set AFTER the side effect succeeded. Log first, act, then mark applied: a
  -- logged decision whose side effect failed leaves this NULL, which is detectable
  -- and repairable. A side effect with no log is invisible AND correlated with
  -- failures, so it biases the record exactly where bias hurts most.
  applied_at timestamptz,

  -- Three words, and a database-enforced no-lookahead guarantee. A future refactor
  -- that reads a row written after the decision fails the INSERT loudly instead of
  -- quietly producing a better-looking model.
  constraint no_lookahead check (feature_asof <= decided_at),
  constraint explore_arm_implies_explore check (explore_arm is null or explore),
  constraint shadow_ref_is_whole check ((shadow_of is null) = (shadow_of_at is null)),
  constraint applied_after_decided check (applied_at is null or applied_at >= decided_at),

  primary key (id, decided_at)      -- a partitioned table's key must carry its key
) partition by range (decided_at);

create index decisions_subject_idx on internal.decisions (subject_kind, subject_id);
create index decisions_stage_idx   on internal.decisions (stage, decided_at desc);
create index decisions_explore_idx on internal.decisions (explore_arm, decided_at desc)
  where explore;
create index decisions_unapplied_idx on internal.decisions (decided_at)
  where applied_at is null;

/* ── partitions ───────────────────────────────────────────────────────────
   Roughly 150,000 rows/day at ~1 KB. Daily partitions with a BRIN-friendly append
   pattern; retention is DROP PARTITION, which is why the row-level guard below can
   forbid DELETE outright without also forbidding cleanup. */

create or replace function internal.ensure_decision_partition(day date)
returns text
language plpgsql
as $$
declare
  part_name text := format('decisions_%s', to_char(day, 'YYYYMMDD'));
begin
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'internal' and c.relname = part_name
  ) then
    execute format(
      'create table internal.%I partition of internal.decisions for values from (%L) to (%L)',
      part_name, day, day + 1);
  end if;
  return part_name;
end
$$;

-- A row landing in the default partition means the partition-maintenance job
-- stopped running. That is a signal worth having; a failed INSERT at 3am is not.
create table internal.decisions_default partition of internal.decisions default;

/* ── append-only, with exactly one permitted edit ─────────────────────────
   The log is append-only, but `applied_at` is stamped after the side effect
   succeeds, so a blanket REVOKE would be a lie about how the table is used. The
   guard below permits precisely that one transition — NULL to non-null, nothing
   else changed — and refuses everything else including from the owner. */

create or replace function internal.decisions_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'internal.decisions is append-only: drop a partition, do not delete rows'
      using errcode = 'restrict_violation';
  end if;

  if old.applied_at is not null then
    raise exception 'decision %/% is already applied; applied_at is stamped once', old.id, old.decided_at
      using errcode = 'restrict_violation';
  end if;
  if new.applied_at is null then
    raise exception 'the only permitted update to internal.decisions is stamping applied_at'
      using errcode = 'restrict_violation';
  end if;
  if (to_jsonb(new) - 'applied_at') <> (to_jsonb(old) - 'applied_at') then
    raise exception 'internal.decisions is append-only: applied_at may change, nothing else may'
      using errcode = 'restrict_violation';
  end if;

  return new;
end
$$;

create trigger decisions_append_only
  before update or delete on internal.decisions
  for each row execute function internal.decisions_guard();

/* ── the policy body ──────────────────────────────────────────────────────
   Every decision records the hash of the thresholds it was judged against. The
   hash is only an audit trail if the body it hashes is still readable, so the
   runner writes the frozen policy object here once at startup, before the first
   decision of that version is logged.

   Deliberately not a foreign key from internal.decisions: a missing policy row
   should be a repairable gap in the audit trail, never a reason a decision fails
   to be recorded at all. */

create table internal.policy (
  policy_hash   text primary key,
  body          jsonb not null,
  first_seen_at timestamptz not null default now(),
  note          text
);

comment on table internal.decisions is
  'Append-only decision log. applied_at is the only column that may ever change.';
