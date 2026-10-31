-- 0155_flow_alarm.sql
--
-- WHAT THE HEALTH CHECK MAY COUNT OF THE PIPELINE'S OUTPUT: name guesses and coin-to-post ties over
-- the last few hours, and over the same hours one and two days before. The round-the-clock health
-- check (services/notify/src/health-alarm.ts, as insidor_people) pushes the owner once when either
-- falls far under its usual and once when it is back.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- 2026-10-30 ~14:00 UTC a change to how the judge is sent pictures (policy.v210) left the namer
-- sending empty pictures. Nothing errored: the namer just named almost nothing — guesses fell from
-- ~90 an hour to ~10, coin ties by name with them, early-catch pushes from ~8 a day to 2, and pushes
-- came at about twice the market cap. Every existing bar stayed green, because each one watches
-- whether a step RUNS, not whether it still PRODUCES. The owner saw it a day later, before we did.
-- The owner, 2026-10-31: "this cant happen again with every change we make or new upgrade".
--
-- internal.flow_counts(now, hours) — for each step, the rows written in (now - hours, now], and in
-- the same window 24 h and 48 h earlier. Two baselines so a bad yesterday does not hide a bad today.
-- A function, not grants on the tables: the alert service sees counts only. `security definer` with
-- a fixed search_path, executable by insidor_people only. Each count is a range on an existing
-- index (name_guess_guessed_at_idx, 0076; one_coin_candidate_found_idx, 0113): six small range
-- scans every five minutes.
--
-- The bar itself (how far under is "fallen") is in services/notify/src/health-bars.ts, shared with
-- tools/health.ts; this file only counts.
--
-- HOW IT IS APPLIED: functions only, no table touched, no lock held past the transaction.
--
-- What breaks if changed carelessly: counting a step by a time column that is rewritten on every
-- pass (an `updated_at`) would count activity, not output — the namer re-touching old rows would
-- look healthy while it names nothing new. Count by the time a row was FIRST written.

create function internal.flow_counts(p_now timestamptz, p_hours integer)
returns table (step text, recent integer, day_before integer, two_days_before integer)
language sql
stable
security definer
set search_path = internal
as $$
  with w as (select make_interval(hours => p_hours) as span)
  select 'names',
         (select count(*)::integer from internal.name_guess, w where guessed_at > p_now - w.span and guessed_at <= p_now),
         (select count(*)::integer from internal.name_guess, w where guessed_at > p_now - interval '24 hours' - w.span and guessed_at <= p_now - interval '24 hours'),
         (select count(*)::integer from internal.name_guess, w where guessed_at > p_now - interval '48 hours' - w.span and guessed_at <= p_now - interval '48 hours')
  union all
  select 'matching',
         (select count(*)::integer from internal.one_coin_candidate, w where found_at > p_now - w.span and found_at <= p_now),
         (select count(*)::integer from internal.one_coin_candidate, w where found_at > p_now - interval '24 hours' - w.span and found_at <= p_now - interval '24 hours'),
         (select count(*)::integer from internal.one_coin_candidate, w where found_at > p_now - interval '48 hours' - w.span and found_at <= p_now - interval '48 hours');
$$;

revoke all on function internal.flow_counts(timestamptz, integer) from public;
grant execute on function internal.flow_counts(timestamptz, integer) to insidor_people;

comment on function internal.flow_counts(timestamptz, integer) is
  'Name guesses and coin-to-post ties in the last N hours and the same window 24 h and 48 h before. For the owner''s health alarm (services/notify health-alarm.ts).';
