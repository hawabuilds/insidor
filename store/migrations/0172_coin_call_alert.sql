-- 0172_coin_call_alert.sql
--
-- EVERY COIN WE SENT A "COIN LAUNCHED" NOTIFICATION FOR IS A CALL (the owner, 2026-11-14: "are you
-- making sure that we're not missing any tokens from the leaderboard?").
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The calls board (services/read calls.ts) listed only the coins a For You card names TODAY. A post
-- whose coin pick changed after we told people, or a coin we told people about from a narrative,
-- dropped off: of the 530 coins that ever got a coin_launched notification, 366 were not on the
-- board — 184 of them pushed to phones. A notification is the call itself; it stays a call whatever
-- the card says later.
--
-- ── WHAT IS ADDED ────────────────────────────────────────────────────────
--
-- public.coin_call_alert   one row per coin: its first coin_launched notification that the app
--                          listed (any delivery but 'refused', as 0158's bubble counts it), when, the
--                          market cap it said, and the post it was for. No user, no delivery, no
--                          words: the read role sees that a call was made, never to whom.
--
-- ★ A VIEW THAT RUNS AS ITS OWNER, as 0134's public.war_coin: the read role is never granted people.
--
-- What breaks if changed carelessly: the kind. fyp_coin, fyp_proven and story_post notices listed every
-- coin near a post (1,629 coins, 83 ever pushed); they are not calls, and counting them would fill the
-- board with coins nobody was told to look at.

create view public.coin_call_alert as
select distinct on (coalesce(nullif(a.facts ->> 'address', ''), a.subject))
       coalesce(nullif(a.facts ->> 'address', ''), a.subject) as address,
       a.at as notified_at,
       case when jsonb_typeof(a.facts -> 'mcUsd') = 'number' then (a.facts ->> 'mcUsd')::float8 end as mc_usd,
       nullif(a.facts ->> 'item', '') as item_id
  from people.alert a
 where a.kind = 'coin_launched'
   and coalesce(a.delivery, '') <> 'refused'
   and coalesce(nullif(a.facts ->> 'address', ''), a.subject) is not null
 order by coalesce(nullif(a.facts ->> 'address', ''), a.subject), a.at;

comment on view public.coin_call_alert is
  'Each coin''s first coin_launched notification the app listed (0172): when, the cap said, the post. No user. A call for the calls board; runs as its owner.';

grant select on public.coin_call_alert to insidor_app;
