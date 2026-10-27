-- 0145_coin_notified_any.sql
--
-- EVERY COIN WE TOLD PEOPLE ABOUT, NOT ONLY THE ONES WE PUSHED (the owner, 2026-10-27: "all tokens should
-- have the logo on the chart where we notified a coin was found"). 0143's view read only the coin
-- pushes that reached a phone ('coin_launched', delivery 'push'), so a coin we showed in the app's
-- Feed but never pushed had no bubble on its chart. A coin is told about by any of three alerts:
--
--   coin_launched   the launch push (subject the coin's address)
--   fyp_coin        a For You post's coin, listed in the Feed (facts.address)
--   fyp_proven      a For You post's proven coin, listed in the Feed (facts.address)
--
-- in any delivery but 'refused' (pushed, listed, held by quiet hours or the day's limit: it was told,
-- on the phone's list if not its lock screen). The first one per coin, with the market cap it said.
--
-- The index keeps the view's lookup by address to that coin's few rows.
--
-- What breaks if changed carelessly: the columns. public.coin_notified keeps 0143's three, in order,
-- so the read service's query (services/read coin-about.ts NOTIFIED_SQL) reads it unchanged. And the
-- view must never carry user_id.

create index if not exists alert_coin_told_idx on people.alert ((coalesce(facts ->> 'address', subject)), at)
  where kind in ('coin_launched', 'fyp_coin', 'fyp_proven') and delivery <> 'refused';

create or replace view public.coin_notified as
select distinct on (coalesce(facts ->> 'address', subject))
       coalesce(facts ->> 'address', subject) as address,
       at as notified_at,
       case when jsonb_typeof(facts -> 'mcUsd') = 'number' then (facts ->> 'mcUsd')::float8 end as mc_usd
  from people.alert
 where kind in ('coin_launched', 'fyp_coin', 'fyp_proven') and delivery <> 'refused'
 order by coalesce(facts ->> 'address', subject), at;

comment on view public.coin_notified is
  'Each coin''s first alert that told people about it (a push or a Feed listing) and the market cap it carried; no user. The token chart''s bubble.';

grant select on public.coin_notified to insidor_app;
