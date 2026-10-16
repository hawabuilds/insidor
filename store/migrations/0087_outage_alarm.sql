-- 0087_outage_alarm.sql
--
-- WHAT THE OWNER'S OUTAGE ALARM MAY READ: when a post last reached For You, whether the judge is
-- being paid for, and when the live coin stream last read. The alarm runs in the alert service
-- (services/notify/src/alarm.ts), as insidor_people, so that it still fires when the thing that
-- broke is the runner, the projector or the coin stream.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-16: "build the alarm (no new FYP post for 45 min, or judge spend drops to $0,
-- or any supplier out of credit) and push it to my phone." On Thursday 2026-10-15 For You took no
-- new post for 111, 51, 125, 315 and 130 minutes, and from 22:18 to 00:20 UTC every judge call was
-- refused and recorded at $0; nothing told him. The alert service is the one process that is
-- neither the runner nor the projector and already pushes to his phone, so it watches both.
--
-- 1. public.feed_post — SELECT, so the alarm can read the newest `first_shown_at` of For You. It is
--    the feed the app already shows; nothing in it is internal.
--
-- 2. internal.judge_pay(since) — the judge's calls since a time, how many were paid for, and when
--    the last paid one was. A function, not a grant on internal.spend: the alert service sees
--    three numbers, never the spend ledger, its vendors or its prices. `security definer` with a
--    fixed search_path, executable by insidor_people only.
--
--    "Paid" is usd > 0 on the live judge's endpoint ('judge'). An answered call is billed from its
--    tokens; a call the supplier refused with a status (out of credit, overloaded, down) is
--    recorded at $0 (adapters/judge/anthropic index.ts). So calls with none paid is the judge being
--    asked and refused — a quiet system makes no calls at all and is never mistaken for it.
--    The last paid call is looked for within a day; older than that is null, said as "none".
--
-- 3. internal.coin_stream_read_at() — the end of the coin stream's last watched window (mint
--    coverage that is not a gap). On Thursday the stream service failed to reach the starved
--    database at 07:13 UTC, stopped restarting, and nothing read a coin from the stream until
--    01:01 the next day; nobody knew for eighteen hours. A partial index on the watched windows'
--    ends keeps this one read off the table, which grows by every few seconds of watching.
--
-- What breaks if changed carelessly: the endpoint name. If the live judge records its calls under
-- another endpoint, this counts nothing and the alarm can never fire (it fails quiet, not loud).
-- Read-only; the alert service still writes nothing outside `people`.

grant select on public.feed_post to insidor_people;

create function internal.judge_pay(p_since timestamptz)
returns table (calls integer, paid integer, last_paid_at timestamptz)
language sql
stable
security definer
set search_path = internal
as $$
  select
    (select count(*)::integer from internal.spend where endpoint = 'judge' and at > p_since),
    (select count(*)::integer from internal.spend where endpoint = 'judge' and at > p_since and usd > 0),
    (select max(at) from internal.spend where endpoint = 'judge' and usd > 0 and at > now() - interval '1 day');
$$;

revoke all on function internal.judge_pay(timestamptz) from public;
grant execute on function internal.judge_pay(timestamptz) to insidor_people;

create index mint_coverage_watched_idx on internal.mint_coverage (window_to desc) where not gap;

create function internal.coin_stream_read_at()
returns timestamptz
language sql
stable
security definer
set search_path = internal
as $$
  select max(window_to) from internal.mint_coverage where not gap;
$$;

revoke all on function internal.coin_stream_read_at() from public;
grant execute on function internal.coin_stream_read_at() to insidor_people;

comment on function internal.coin_stream_read_at() is
  'When the live coin stream last read: the end of its newest watched (not gap) coverage window. For the owner''s outage alarm.';
comment on function internal.judge_pay(timestamptz) is
  'The live judge''s calls since a time, how many were paid (usd > 0), and the last paid call within a day. For the owner''s outage alarm (services/notify alarm.ts).';
