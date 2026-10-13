-- 0073_public_lockdown.sql
--
-- TAKES BACK WHAT SUPABASE GAVE THE PUBLIC KEY. Until now the platform's default grants let the
-- roles behind its public API key, `anon` and `authenticated`, select, insert, update, delete and
-- truncate every table and view in `public`, and execute the trade and launch writers, with row
-- security off everywhere. Nothing of ours uses those roles: the app reads only through the read
-- service, and every process connects as `postgres` or one of our own login roles
-- (insidor_app_user, insidor_people_user). But anyone holding the API key could have rewritten or
-- wiped the feed, the posts and the coins through the platform's REST endpoint.
--
-- THREE LAYERS, so one mistake later does not reopen it:
--   1. revoke every table, sequence and function privilege in `public` from anon and authenticated,
--      and from PUBLIC on the one trigger function that had it;
--   2. stop the platform granting them on tables, sequences and functions `postgres` creates later;
--   3. turn row security on for every table in `public`, with one permissive policy for OUR four
--      roles only. The policy grants nothing by itself — each role still has exactly the table
--      grants 0001 onward gave it — it only means row security does not lock our own readers out.
--      `postgres` and `service_role` bypass row security, so the projector, the runner and storage
--      are unaffected. A role with no policy (anon, authenticated) sees no rows even if a grant
--      comes back.
--
-- ★ A NEW TABLE IN `public` NEEDS THE SAME TWO LINES: `enable row level security` and the
-- `insidor_roles` policy. Without the policy, insidor_app_user (the read service) and
-- insidor_people_user (the social service) get no rows from it: an empty answer, not an error.
--
-- `service_role` is left as it is: storage uploads use its key. The platform's own defaults for
-- objects created by `supabase_admin` cannot be changed from here; we never create objects as it.

revoke execute on function public.remember_coin_name() from public;

/* Only on the platform: a plain Postgres (a local or test database) has no anon or authenticated
   role, and no `postgres` default privileges to take back. */
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      if exists (select 1 from pg_roles where rolname = 'postgres') then
        execute format('alter default privileges for role postgres in schema public revoke all on tables from %I', r);
        execute format('alter default privileges for role postgres in schema public revoke all on sequences from %I', r);
        execute format('alter default privileges for role postgres in schema public revoke all on functions from %I', r);
      end if;
    end if;
  end loop;
end
$$;

do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    execute format('drop policy if exists insidor_roles on public.%I', t.relname);
    execute format(
      'create policy insidor_roles on public.%I for all to insidor_app, insidor_people, insidor_service, insidor_internal using (true) with check (true)',
      t.relname
    );
  end loop;
end
$$;
