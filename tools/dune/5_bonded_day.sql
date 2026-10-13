-- 5_bonded_day.sql — the coins that BONDED (graduated off the curve) in a window ending now.
--
-- One row per coin: its address, when it was created and bonded, the name, ticker and the
-- metadata link its creator wrote. The daily recall check (tools/recall-check.ts) reads the
-- metadata itself and keeps the coins whose creator linked an X post.
--
-- Why a separate query from 1_graduated.sql: that one pages the launchpad's whole history by
-- creation date; this one asks only for the last {{since_hours}} hours of bonding, so it scans
-- one day of the completion events and costs a few credits rather than a census.
--
-- The create calls are read back {{create_days}} days only (a coin created before that has a
-- null created_at and is recorded as "launch unknown", never dropped): unbounded, the join
-- scans every create call since the launchpad began, every day, for the same handful of rows.

with graduated as (
  select mint, min(evt_block_time) as graduated_at
    from pumpdotfun_solana.pump_evt_completeevent
   where evt_block_time >= now() - interval '{{since_hours}}' hour
   group by mint
),
created as (
  select account_mint as mint, call_block_time as created_at, name, symbol, uri
    from pumpdotfun_solana.pump_call_create
   where call_block_time >= now() - interval '{{create_days}}' day
  union all
  select account_mint, call_block_time, name, symbol, uri
    from pumpdotfun_solana.pump_call_create_v2
   where call_block_time >= now() - interval '{{create_days}}' day
)
select g.mint, c.created_at, g.graduated_at, c.name, c.symbol, c.uri
  from graduated g
  left join created c on c.mint = g.mint
 order by g.graduated_at
