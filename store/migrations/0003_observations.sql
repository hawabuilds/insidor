-- 0003_observations.sql
--
-- The counter time series. One row is one reading of one counter of one item at
-- one instant, together with an honest statement of how much that reading can be
-- trusted.
--
-- APPEND-ONLY, NEVER UPDATED, NEVER PRUNED.
-- This is the asset that cannot be bought and cannot be backfilled. A vendor will
-- sell you the current value of a counter; nobody will sell you what it was at
-- 03:14 last Tuesday, and the whole product is built on differences. A retention
-- job written for disk reasons in month four destroys the only training corpus the
-- system will ever have, so there is deliberately no retention here and no UPDATE
-- path to correct a row with. A correction is a new reading.

create table public.observation (
  item_id     text not null references public.item (item_id) on delete cascade,
  kind        text not null check (kind in
                ('reach', 'approval', 'conversation', 'rebroadcast', 'reproduction', 'retention')),
  captured_at timestamptz not null,          -- when WE read it

  -- NULL means "not read on this pass". The ABSENCE OF THE CONCEPT is
  -- fidelity_kind = 'absent', which is a different statement and must stay one.
  value       double precision,

  fidelity_kind   text not null check (fidelity_kind in ('exact', 'quantized', 'fuzzed', 'absent')),
  fidelity_digits integer,                   -- significant digits, when quantized
  observed_at     timestamptz not null,      -- the counter's own timestamp, if it has one
  lag_ms          integer,                   -- set only when the source admits its staleness

  -- The differenced quantity, per minute, or NULL when the reading was censored.
  --
  -- ★ NULL AND ZERO ARE NOT THE SAME NUMBER HERE, and conflating them is the single
  -- most expensive bug in the build this replaces. A censored reading means we
  -- learned nothing. Writing 0 says the item is flat, downstream reads flat as
  -- cooling, and cooling demotes it — so the failure hides acceleration, which is
  -- the only thing we are paid to notice.
  rate_per_min double precision,
  censored     text check (censored in
                 ('unusable_fidelity', 'below_step', 'stale_counter', 'non_monotonic', 'no_prior')),

  -- Exactly one of the two is set, always. There is no third state in which a row
  -- has neither a rate nor a reason for not having one.
  constraint rate_xor_censor check ((rate_per_min is null) = (censored is not null)),
  constraint quantized_declares_digits check
    (fidelity_kind <> 'quantized' or fidelity_digits is not null),
  constraint absent_has_no_value check
    (fidelity_kind <> 'absent' or value is null),

  primary key (item_id, kind, captured_at)
);

-- The series is read as "this item, this counter, in time order" and swept as
-- "everything in this window". BRIN because the table is append-only and therefore
-- physically ordered by time already — a btree on captured_at would cost 20× the
-- space for the same plan.
create index observation_time_brin on public.observation using brin (captured_at);

-- Censoring rate by week is the earliest sign a source changed shape under us.
create index observation_censored_idx on public.observation (censored, captured_at)
  where censored is not null;

create trigger observation_is_append_only
  before update or delete on public.observation
  for each row execute function internal.forbid_mutation();

comment on table public.observation is
  'Append-only counter series. Never updated, never pruned. A correction is a new row.';

-- NOT granted to insidor_app. Fidelity and censoring are core machinery, and a
-- client that can read a censor reason can re-derive the rate we deliberately
-- refused to publish. The app gets facts through a projection instead.
