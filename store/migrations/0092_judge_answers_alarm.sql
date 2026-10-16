-- 0092_judge_answers_alarm.sql
--
-- WHAT THE OWNER'S JUDGE ALARM MAY READ NOW: for each judge supplier, how often it was asked and
-- how many posts it answered, so the alert service can say "the judge has stopped answering" and
-- "the backup failed too" whichever supplier is the judge. Read by services/notify/src/alarm.ts,
-- as insidor_people, beside 0087's three readings.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-16: "push me if the judge or backup stops answering". 0087's judge_pay counts
-- calls on the endpoint 'judge' with usd > 0, which is the Anthropic judge's shape: it cannot see the
-- open-model judge (endpoint 'judge-open'), which is becoming the judge, nor any backup on another
-- host. And "paid" is not "answered": the meter charges a call that throws (a timeout, a broken
-- reply) at its estimate, so a judge that times out on every batch looks paid for. On 2026-10-13
-- from 00:10 UTC, 157 judge calls in a quarter-hour were charged and not one post was answered.
--
-- So "answered" is read from the answers themselves: internal.post_judgement rows from a model
-- judge (judge_id 'judge:<vendor>/<model>…'), not copied from another post. Copies and rule
-- answers ('rule:…') are not the judge answering. The shadow judge's answers go to their own table
-- (0089) and are never counted, nor are its calls (endpoint 'judge-shadow'), nor the learning book's
-- ('learn:…'): neither is the live judge being asked.
--
-- "Asked" is read from the spend ledger: every live judge call is metered, answered or not —
-- refused with a status at $0, thrown at the estimate. Live judge endpoints are 'judge' and any
-- 'judge-…' but 'judge-shadow', so a backup host metered as 'judge-backup' (say) is counted
-- without another migration.
--
-- 1. internal.judge_lines(since) — per supplier (the spend row's vendor; the vendor in the answer's
--    judge id): calls since `since`, posts answered since `since`, and the last answer within a
--    day (older is null, said as "none"). `security definer` with a fixed search_path, executable by
--    insidor_people only: the alert service sees counts and times, never the ledger's prices, the
--    posts, or what the judge said about them.
--
-- 2. An index on post_judgement (judged_at desc): the alarm asks for the last quarter-hour every
--    minute, and the table grows by every post judged (about 10,000 a day).
--
-- 0087's judge_pay is kept, not dropped: an alert service deployed before this migration still
-- reads it, and the new one falls back to it until this is applied.
--
-- What breaks if changed carelessly: the judge id's shape. Both judge adapters write
-- 'judge:<vendor>/<model>…'; a judge that wrote another would be asked and never seen answering,
-- and the alarm would fire on a working judge (loud, not quiet — the safer way to be wrong).

create index post_judgement_judged_idx on internal.post_judgement (judged_at desc);

create function internal.judge_lines(p_since timestamptz)
returns table (vendor text, calls integer, answered integer, last_answered_at timestamptz)
language sql
stable
security definer
set search_path = internal
as $$
  with asked as (
    select s.vendor, count(*)::integer as calls
      from internal.spend s
     where s.at > p_since
       and (s.endpoint = 'judge' or (s.endpoint like 'judge-%' and s.endpoint <> 'judge-shadow'))
     group by s.vendor
  ), answers as (
    select split_part(split_part(j.judge_id, ':', 2), '/', 1) as vendor,
           count(*) filter (where j.judged_at > p_since)::integer as answered,
           max(j.judged_at) as last_answered_at
      from internal.post_judgement j
     where j.judged_at > least(p_since, now() - interval '1 day')
       and j.judge_id like 'judge:%'
       and j.copied_from is null
     group by 1
  )
  select coalesce(a.vendor, b.vendor), coalesce(a.calls, 0), coalesce(b.answered, 0), b.last_answered_at
    from asked a
    full join answers b on b.vendor = a.vendor;
$$;

revoke all on function internal.judge_lines(timestamptz) from public;
grant execute on function internal.judge_lines(timestamptz) to insidor_people;

comment on function internal.judge_lines(timestamptz) is
  'Per judge supplier: live judge calls since a time, posts it answered since then, and its last answer within a day. For the owner''s judge and backup alarms (services/notify alarm.ts).';
