-- 0141_tape_coin.sql
--
-- THE TAPE'S COINS, FOR THE BROWSER'S ROLE (the owner, 2026-10-26: "the coins that are trending last
-- 24 hrs that have viral post origin, regardless how old the post is").
--
-- The read service answers as insidor_app, which reads a hand-picked set of public tables and never
-- internal. The tape now draws on coins a post's or a narrative's pick held and coins the owner
-- called right (internal.post_coin_pick, narrative_coin_pick, owner_feedback), so this view runs that
-- query as its owner and hands insidor_app only the finished rows: each coin as a card carries it (its
-- newest reading in the last two hours), the dollars it traded over the last day (each hour counted
-- once, at that hour's busiest reading), and its asset row's venue and origin for the read service's
-- own gate (services/read running-coins.ts). Nothing of the picks — no post, no evidence — is exposed.
--
-- What breaks if changed carelessly: `security_invoker`. Set, the view would run as insidor_app and
-- fail on internal; the default (off) is the point.

create view public.tape_coin as
with origin as (
  select address from internal.post_coin_pick where outcome = 'picked' and address is not null
  union
  select address from internal.narrative_coin_pick where outcome = 'picked' and address is not null
  union
  select coin_address from internal.owner_feedback where subject_kind = 'coin_match' and verdict in ('right', 'wrong') and coin_address is not null
),
coin as (
  select a.address, a.symbol, a.image_uri, a.venue_id, a.origin, a.asset_key
    from public.asset a join origin o on o.address = a.address
   where a.chain = 'solana'
),
hours as (
  select m.asset_key, date_trunc('hour', m.taken_at) as h, max(m.volume_1h_usd) as v
    from public.market_reading m join coin c on c.asset_key = m.asset_key
   where m.taken_at >= now() - interval '24 hours' and m.volume_1h_usd is not null
   group by 1, 2
),
day as (select asset_key, sum(v) as volume_24h from hours group by 1),
latest as (
  select distinct on (m.asset_key) m.asset_key, m.taken_at, m.market_cap_usd, m.price_change_24h_pct, m.volume_1h_usd,
         coalesce(m.buys_1h, 0) + coalesce(m.sells_1h, 0) as trades, m.tradable
    from public.market_reading m join coin c on c.asset_key = m.asset_key
   where m.taken_at >= now() - interval '2 hours'
   order by m.asset_key, m.taken_at desc
)
select jsonb_build_object(
         'coinId', 'solana:' || c.address, 'address', c.address, 'ticker', c.symbol, 'imageUrl', c.image_uri,
         'tradable', coalesce(l.tradable, false),
         'marketCapUsd', jsonb_build_object('v', l.market_cap_usd),
         'priceChange24h', jsonb_build_object('v', l.price_change_24h_pct),
         'volume1hUsd', jsonb_build_object('v', l.volume_1h_usd),
         'trades1h', jsonb_build_object('v', l.trades),
         'volume24hUsd', jsonb_build_object('v', d.volume_24h)
       ) as coin,
       (extract(epoch from l.taken_at) * 1000)::bigint as at_ms, c.venue_id, c.origin
  from coin c join latest l on l.asset_key = c.asset_key join day d on d.asset_key = c.asset_key;

comment on view public.tape_coin is
  'The running coins strip''s rows (0141): coins of viral posts we found, any age, with their newest reading and last day''s dollars. Runs as its owner; insidor_app reads only this.';

grant select on public.tape_coin to insidor_app;
