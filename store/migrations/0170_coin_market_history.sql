-- 0170_coin_market_history.sql
--
-- A COIN'S MARKET READINGS OVER TIME, READABLE BY THE READ SERVICE, FOR INSIDOR'S OWN CALLS (the owner,
-- 2026-11-13: the Feed tab's Calls list, services/read calls.ts).
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- A call's numbers come from our own candles (0144, public.coin_candle) first. Two things still need
-- the market readings: the coin's supply (its cap over its price), which turns a candle's price into a
-- market cap, and the start and peak of a coin we never charted. The app role is not granted
-- public.market_reading (0134 says so); the first deploy of the Calls list answered every one of its
-- 562 calls "permission denied for table market_reading" and showed an empty record.
--
-- ── WHAT IS ADDED ────────────────────────────────────────────────────────
--
-- public.coin_market_history   one row per Solana reading: the coin, when it was taken, its market
--                              cap and price, and the dollars it traded in the hour before. Nothing
--                              else of the table: no venue, no vendor, no absence reasons.
--
-- ★ A VIEW, AS 0134's public.war_coin, BECAUSE THE APP ROLE CANNOT READ THE TABLE. It runs as its
-- owner (no security_invoker), so the read role sees these five columns and nothing more. The filter
-- on chain keeps market_reading's primary key (chain, address, taken_at) usable: a read of one
-- coin's readings from a time on walks the index, as the calls' per-coin read needs.
--
-- What breaks if changed carelessly: setting security_invoker. The view would then run as the read
-- role and fail exactly as the table does.

create view public.coin_market_history as
select m.address, m.taken_at, m.market_cap_usd, m.price_usd, m.volume_1h_usd
  from public.market_reading m
 where m.chain = 'solana';

comment on view public.coin_market_history is
  'Each Solana coin''s market readings over time (0170): when taken, cap, price and the last hour''s dollars traded. For the read service''s calls list; runs as its owner.';

grant select on public.coin_market_history to insidor_app;
