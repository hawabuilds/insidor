-- 0149_role_statement_timeout.sql
--
-- A CEILING EVERY SERVICE'S STATEMENTS ARE HELD TO, WHATEVER THE POOLER DROPS (2026-10-28). The
-- services connect as `postgres` through the transaction-mode pooler, which ignores the
-- `statement_timeout` a pool sends at connect (store/src/client.ts says so: "the durable fix is a
-- per-role `alter role ... set statement_timeout`, which is a migration"). A statement outside a
-- `withTransaction` therefore ran with no limit at all: that morning a namer read ran 18 minutes and a
-- picture search two, on a disk-bound database, and For You's full rebuild failed every run for three
-- hours behind them.
--
-- Five minutes, not a service's own 30–60 s: this is a ceiling for runaways, not the services' budget.
-- The hourly label pass and the archive jobs run statements of minutes and keep working; anything
-- that needs longer sets its own (`set local statement_timeout`, as tools/apply-one and the re-tune's
-- bench do). New sessions read it; the pooler's open server connections pick it up as they recycle.
--
-- What breaks if changed carelessly: lowering it under the slowest legitimate job's statement fails
-- that job every run. Check pg_stat_statements' max_exec_time before lowering.

-- Each role only where it exists: a fresh or test database (e2e's) has neither of the hosted roles.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    execute 'alter role postgres set statement_timeout = ''300s''';
  end if;
  if exists (select 1 from pg_roles where rolname = 'insidor_app_user') then
    execute 'alter role insidor_app_user set statement_timeout = ''60s''';
  end if;
end $$;
