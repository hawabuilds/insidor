-- 0152_health_alarm.sql
--
-- WHAT THE ROUND-THE-CLOCK HEALTH CHECK MAY READ: the last hour of coin-logo copies with the newest
-- stored logo's address, and how many posts were judged since a time. The check runs in the alert
-- service (services/notify/src/health-alarm.ts) as insidor_people, beside the outage alarm (0087,
-- 0092), and pushes the owner once when a bar breaks and once when it is back.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- 2026-10-29: picture storage was cut off at 01:00 UTC for going over its transfer allowance and
-- every coin logo, poster and post picture stopped loading. tools/health.ts reads exactly these
-- facts, but it runs by hand around deploys, and nobody noticed for 13 hours.
--
-- 1. internal.picture_health(since) — the coin-logo copies checked since a time, how many failed,
--    and the address of the newest stored logo (the alarm fetches it from picture storage the way
--    the app does). A function, not a grant on internal.coin_logo: the alert service sees two counts
--    and one address. `security definer` with a fixed search_path, executable by insidor_people only.
--
--    Counted as stored + not stored, each half on its own partial index, so the hourly window never
--    reads the whole table: coin_logo_retry_idx (0059) already covers the rows not stored, and
--    coin_logo_stored_idx below covers the stored ones and answers "newest stored" from its top.
--
-- 2. internal.judged_since(since) — posts judged since a time, from post_judgement_judged_idx (0092).
--    The judge alarm (0092) sees the judge asked and refused; this sees nothing being judged at all.
--
-- HOW IT IS APPLIED: a plain index build, in the migrator's one transaction. It holds writes to
-- internal.coin_logo — the logo mirror job's, nothing a person waits on — for the seconds the build
-- takes. If the table is ever large enough for that to matter, build it first by hand with CREATE
-- INDEX CONCURRENTLY (as 0146 and 0147 were); `if not exists` then finds it built.
--
-- What breaks if changed carelessly: the outcome names. A copy the job records under a new outcome
-- would be counted by neither half, and the alarm would read a broken mirror as a quiet hour.

create index if not exists coin_logo_stored_idx on internal.coin_logo (checked_at desc) where outcome = 'stored';

create function internal.picture_health(p_since timestamptz)
returns table (copies integer, failed integer, stored_address text)
language sql
stable
security definer
set search_path = internal
as $$
  select
    (select count(*)::integer from internal.coin_logo where outcome = 'stored' and checked_at > p_since)
      + (select count(*)::integer from internal.coin_logo where outcome <> 'stored' and checked_at > p_since),
    (select count(*)::integer from internal.coin_logo where outcome = 'failed' and checked_at > p_since),
    (select address from internal.coin_logo where outcome = 'stored' order by checked_at desc limit 1);
$$;

revoke all on function internal.picture_health(timestamptz) from public;
grant execute on function internal.picture_health(timestamptz) to insidor_people;

create function internal.judged_since(p_since timestamptz)
returns integer
language sql
stable
security definer
set search_path = internal
as $$
  select count(*)::integer from internal.post_judgement where judged_at > p_since;
$$;

revoke all on function internal.judged_since(timestamptz) from public;
grant execute on function internal.judged_since(timestamptz) to insidor_people;

comment on function internal.picture_health(timestamptz) is
  'Coin-logo copies since a time, how many failed, and the newest stored logo''s address. For the owner''s health alarm (services/notify health-alarm.ts).';
comment on function internal.judged_since(timestamptz) is
  'Posts judged since a time. For the owner''s health alarm (services/notify health-alarm.ts).';
