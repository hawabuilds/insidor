-- 0134_war_coin.sql
--
-- THE ONE COIN OF THE WHOLE "TWITTER WORLD WAR", AS THE OWNER CHOSE IT, READABLE BY THE READ SERVICE.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-24: "build the world war coin on the card". The Narratives tab's "Twitter World
-- War" card (every online meme war between countries, 0130) shows ONE coin for the whole war, with
-- its logo, ticker, market cap, the day's move and Buy. Which coin is his call, and he must be able
-- to change it without a release, so it is stored as an owner call, like every other.
--
-- ── WHAT IS ADDED ────────────────────────────────────────────────────────
--
-- No new kind of call. The war's coin is an owner_feedback row with subject 'narrative' on the fixed
-- id 'twitter-world-war' (never a narrative id: the runner names narratives `n-…` and by their
-- anchor post), verdict 'right' with `coin_address`, or 'cleared' with none to take the coin off —
-- shapes 0130's check already allows. No members are stored, so the runner's fold of narrative calls
-- (core group/narrative.ts `coinCallFor`) never applies it to a real narrative: an id no narrative
-- has, and no posts to follow. services/social writes it ("Coin for Twitter World War" on the sheet).
--
-- public.war_coin   the newest such call, when it names a coin: the address, the coin's own facts
--                   from public.asset, and its newest market reading (cap, the day's move,
--                   tradable, when it was taken), each absence with the venue's reason. No row
--                   when no coin was ever chosen or the newest call cleared it.
--
-- ★ A VIEW, AS 0059's public.coin_link, BECAUSE THE APP ROLE CANNOT READ EITHER SOURCE: the owner's
-- calls are internal and market_reading is not granted to it. The view hands it exactly one coin's
-- reading and nothing else of either table. The reading is raw: the read service applies the same
-- freshness rule the projector does (Policy.market.readingFreshnessMs) before anything reaches the
-- screen, so an old reading is a dash "not read yet", never a current cap. The market reader reads
-- this view too, so the coin is read every pass (services/market db.ts).
--
-- What breaks if changed carelessly: the fixed id. services/social owner-narrative.ts `WAR_ID` writes
-- it and this view reads it; a different spelling in either loses the owner's coin without an error.

create view public.war_coin as
with chosen as (
  select f.coin_address, f.verdict, f.created_at
    from internal.owner_feedback f
   where f.subject_kind = 'narrative' and f.item_id = 'twitter-world-war' and f.verdict in ('right', 'cleared')
   order by f.created_at desc, f.id desc
   limit 1
)
select c.coin_address as address,
       'solana:' || c.coin_address as asset_key,
       a.symbol, a.name, a.image_uri,
       m.market_cap_usd, m.market_cap_absent,
       m.price_change_24h_pct, m.price_change_24h_absent,
       m.tradable, m.taken_at,
       c.created_at as chosen_at
  from chosen c
  left join public.asset a on a.chain = 'solana' and a.address = c.coin_address
  left join lateral (
    select r.market_cap_usd, r.market_cap_absent, r.price_change_24h_pct, r.price_change_24h_absent, r.tradable, r.taken_at
      from public.market_reading r
     where r.asset_key = 'solana:' || c.coin_address
     order by r.taken_at desc
     limit 1
  ) m on true
 where c.verdict = 'right' and c.coin_address is not null;

comment on view public.war_coin is
  'The coin the owner chose for the whole Twitter World War (0134): its facts and newest raw market reading; no row when none is chosen.';

grant select on public.war_coin to insidor_app;
grant select on public.war_coin to insidor_service, insidor_internal, insidor_people;
