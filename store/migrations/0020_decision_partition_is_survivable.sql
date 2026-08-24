-- 0020_decision_partition_is_survivable.sql
--
-- ★ WHAT THIS OWNS: the one behaviour of `internal.ensure_decision_partition` that
-- decided whether `pnpm db:decide` worked — what it does when the DEFAULT partition
-- already holds rows for the day being created.
--
-- ── THE FAILURE, EXACTLY AS IT WAS FOUND ──────────────────────────────────
--
-- `internal.decisions` is RANGE-partitioned on `decided_at` with a DEFAULT partition,
-- and 0006 says why: "A row landing in the default partition means the partition-
-- maintenance job stopped running. That is a signal worth having; a failed INSERT at
-- 3am is not." The default exists so that a WRITE never fails.
--
-- The maintenance job was `services/runner`, and it never called this function — only
-- `decide-once.ts` did. So the always-on runner wrote every decision it ever made into
-- `decisions_default`. Then the next `pnpm db:decide` called this function, Postgres
-- had to re-validate the default partition against the new range, found rows that
-- belonged in it, and raised 23514:
--
--   updated partition constraint for default partition "decisions_default"
--   would be violated by some row
--
-- The function raised, `decide-once.ts` exited 1, and it did so FOREVER — stopping the
-- runner did not help, because the rows were still there. The only documented recovery
-- was `pnpm db:reset`, which drops the one table SETUP.md describes
-- as unbackfillable. Two documented commands, and running one destroyed the other.
--
-- ── THE DECISION, AND ITS CONSEQUENCE ─────────────────────────────────────
--
-- The real repair is upstream and is in `services/runner/src/main.ts`: the runner now
-- creates today's and tomorrow's partitions at boot and once a day after that, so rows
-- stop arriving in the default at all. That is the fix. This is the second half of it,
-- and it is a different claim: WHEN A ROW IS ALREADY THERE, THIS FUNCTION MUST NOT BE
-- THE THING THAT BREAKS.
--
-- Turning a full default partition into a hard error inverted the whole reason the
-- default exists. A day's rows in the wrong partition is a maintenance signal — the
-- rows are present, correct, queryable and joinable to labels through the same
-- `subject_id`; nothing about the log is lost. Refusing to create any further partition
-- because of it converted a bookkeeping smell into an outage of the write path.
--
-- So: look before leaping. If the default already holds rows for `day`, say so as a
-- WARNING and return `decisions_default` — the partition those rows are genuinely in,
-- and the one the next INSERT will route to anyway. The caller carries on and writes
-- its decisions. If the default is clear, create the daily partition exactly as before.
--
-- ★ WHAT BREAKS IF THIS IS CHANGED CARELESSLY. Two things, in opposite directions:
--
--   1. Making it raise again reintroduces the outage above. If you want the loud
--      version, put it in a monitor that reads `decisions_default`, never on the path
--      of a write.
--   2. Making it SILENT — dropping the RAISE WARNING — is worse than either. The return
--      value is then indistinguishable from a healthy call, and a system permanently
--      writing into its own "maintenance has stopped" signal would look completely
--      normal. The warning is the entire remaining alarm.
--
-- It does NOT move the rows. Moving them means DELETE on an append-only table whose
-- 0006 trigger forbids exactly that, and `store/src/migrations.test.ts` forbids the
-- statement appearing in a numbered migration at all. Both refusals are right: a
-- forward-only migration that relocates rows in the decision log is a rewrite of the
-- audit trail, and the audit trail is the asset. Repartitioning is a deliberate,
-- attended operation and does not belong in a function called on every boot.

create or replace function internal.ensure_decision_partition(day date)
returns text
language plpgsql
as $$
declare
  part_name text := format('decisions_%s', to_char(day, 'YYYYMMDD'));
  stranded  bigint;
begin
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'internal' and c.relname = part_name
  ) then
    return part_name;
  end if;

  /* Checked before the CREATE rather than caught after it. The CREATE takes an ACCESS
     EXCLUSIVE lock on the default partition while it re-validates, so a concurrent
     INSERT cannot slip a row in between this count and that statement — and the
     EXCEPTION block below is still there for the case this reasoning is wrong. */
  select count(*) into stranded
    from internal.decisions_default
   where decided_at >= day and decided_at < day + 1;

  if stranded > 0 then
    raise warning
      'decision partition % was not created: internal.decisions_default already holds % row(s) for %. Those rows are safe and queryable, and writing continues into the default partition — but partition maintenance has not been running, which is what the default partition exists to tell you. The runner creates these at boot; check that it is up.',
      part_name, stranded, day;
    return 'decisions_default';
  end if;

  begin
    execute format(
      'create table internal.%I partition of internal.decisions for values from (%L) to (%L)',
      part_name, day, day + 1);
  exception
    /* 23514 is the default-partition re-validation failing. Reached only if a row for
       `day` landed between the count above and this statement. Same answer as above:
       the write path keeps working and the warning is what says maintenance is behind. */
    when check_violation then
      raise warning
        'decision partition % could not be created: a row for % reached internal.decisions_default while it was being made. Writing continues into the default partition.',
        part_name, day;
      return 'decisions_default';
  end;

  return part_name;
end
$$;

comment on function internal.ensure_decision_partition(date) is
  'Create the daily partition for `day` if it is absent. Returns the partition an INSERT for that day will reach — which is decisions_default, with a warning, when the default already holds rows for that day. Never raises: the default partition exists so that a write never fails, and this function is on the path of every write.';
