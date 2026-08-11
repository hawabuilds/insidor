-- 0001_schemas.sql
--
-- The three schemas and the roles that separate them.
--
-- WHY A SCHEMA SPLIT RATHER THAN A COLUMN LIST OR A ROW POLICY:
-- the previous build granted the anonymous key SELECT on a scores table with
-- `using (true)`, and the app then rendered what it happened to have. Every fix of
-- that shape is a rule somebody has to remember at the moment they write a
-- `.select()` string. A schema the HTTP layer has never been taught about has no
-- URL, so there is no grant to get wrong.
--
--   public    the app-facing vocabulary. PostgREST exposes this schema.
--             Grants inside it are per-table and explicit — there are deliberately
--             NO default privileges for the app role, so a table added by a later
--             migration is invisible to the app until someone writes the grant by
--             hand. Forgetting is the safe direction.
--   internal  every judgement we ever made: decisions, labels, features, stage runs.
--             NOT in PostgREST's exposed-schemas list. The app role has no USAGE
--             here, so it cannot name a table in this schema even to be refused.
--   raw       vendor captures, kept so a payload can be re-read and re-parsed after
--             an adapter bug. Nothing downstream reads it on the hot path.

create schema if not exists internal;
create schema if not exists raw;

-- Postgres 15+ already revokes this, but say it out loud: nothing may create
-- objects in `public` except the migration owner.
revoke create on schema public from public;

/* ── roles ────────────────────────────────────────────────────────────────
   These are NOLOGIN group roles. The deploy grants them to whatever login user
   the platform issues (on Supabase, `insidor_app` is granted to `anon` and
   `authenticated`). Creating group roles here keeps the privilege *shape* in the
   migration history, where it is reviewable, while leaving credentials outside it.

   Three roles, one ladder, each step justified by a process that needs it:
     insidor_app       the browser. Reads a hand-picked set of public tables.
     insidor_service   ingest and tracking. Read-write on public and raw; may READ
                       internal (the watchdog's two queries live here) but may not
                       write a judgement.
     insidor_internal  the runner and the labeller. The only role that may write a
                       decision, a label or a stage run.

   The middle step is the one that earns its keep: an ingest process that acquires
   a bug cannot append to the decision log, because the connection it holds has no
   INSERT there. */

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'insidor_app') then
    create role insidor_app nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'insidor_service') then
    create role insidor_service nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'insidor_internal') then
    create role insidor_internal nologin;
  end if;
end
$$;

-- public: everyone may USE the schema; what they may read inside it differs.
grant usage on schema public to insidor_app, insidor_service, insidor_internal;

-- internal: the app is not mentioned. Not revoked — never granted.
grant usage on schema internal to insidor_service, insidor_internal;
revoke all on schema internal from public;

-- raw: vendor payloads. The app has no business here either.
grant usage on schema raw to insidor_service, insidor_internal;
revoke all on schema raw from public;

/* Default privileges apply to objects created later by the migration owner, so the
   service and internal roles do not need a grant line in every migration. This is
   deliberately NOT done for insidor_app: its access must stay a per-table decision. */
alter default privileges in schema public
  grant select, insert, update, delete on tables to insidor_service, insidor_internal;
alter default privileges in schema public
  grant usage, select on sequences to insidor_service, insidor_internal;

alter default privileges in schema raw
  grant select, insert on tables to insidor_service, insidor_internal;
alter default privileges in schema raw
  grant usage, select on sequences to insidor_service, insidor_internal;

alter default privileges in schema internal
  grant select on tables to insidor_service;
alter default privileges in schema internal
  grant select, insert, update on tables to insidor_internal;
alter default privileges in schema internal
  grant usage, select on sequences to insidor_internal;

/* ── the append-only guard ────────────────────────────────────────────────
   Used by the observation series and by the decision log. A REVOKE would work for
   one role and leave the owner free; a trigger holds for everybody including the
   migration owner and including a psql session at 3am.

   DROP PARTITION and TRUNCATE are DDL and do not fire row triggers, so retention
   still works. That is intended: dropping a whole closed day is a policy, editing
   one row is a lie. */

create or replace function internal.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    '% is append-only: % is not permitted (drop a partition instead)',
    tg_table_name, tg_op
    using errcode = 'restrict_violation';
end
$$;

comment on function internal.forbid_mutation() is
  'Attach as a BEFORE UPDATE OR DELETE trigger to any table whose history must not be edited.';
