-- 0143_coin_notified.sql
--
-- WHEN WE TOLD PEOPLE ABOUT A COIN, FOR THE BROWSER'S ROLE (the owner, 2026-10-27, the token chart:
-- "I want it similar to the pump.fun screenshot showing when traders bought … I mean when we
-- notified users of the coin"). The token chart puts our logo, as a bubble, on the candle where we
-- first pushed the coin, at the market cap the push carried.
--
-- The read service answers as insidor_app, which never reads the people schema. Each coin push is a
-- row of people.alert per person (kind 'coin_launched', subject the coin's address, facts.mcUsd the
-- cap the push said); this view runs as its owner and hands insidor_app one row per coin — its first
-- push that reached a phone and that push's market cap — and nothing about who received it.
--
-- The index keeps the view's lookup by address from reading every alert ever sent: one coin's
-- pushes are a short range of it.
--
-- What breaks if changed carelessly: `security_invoker`. Set, the view would run as insidor_app and
-- fail on people; the default (off) is the point. And the view must never carry user_id.

create index if not exists alert_coin_push_idx on people.alert (subject, at) where kind = 'coin_launched' and delivery = 'push';

create view public.coin_notified as
select distinct on (subject)
       subject as address,
       at as notified_at,
       case when jsonb_typeof(facts -> 'mcUsd') = 'number' then (facts ->> 'mcUsd')::float8 end as mc_usd
  from people.alert
 where kind = 'coin_launched' and delivery = 'push'
 order by subject, at;

comment on view public.coin_notified is
  'Each coin''s first push that reached a phone and the market cap it carried; no user. The token chart''s bubble.';

grant select on public.coin_notified to insidor_app;
