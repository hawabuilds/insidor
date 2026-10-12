-- 0_counts.sql — STAGE 0: how big each stage is, before anything is fetched.
--
-- Run first, on its own. It reads only counts, returns one row, and is the cheapest query in
-- the plan; every size and cost in docs/coin-universe-history-plan.md is a guess until it runs.
--
-- ★ CHECK THE TABLE NAMES FIRST. These are Dune's decoded tables for the launchpad's program
-- (6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P): the two create instructions (the original
-- and the Token-2022 `create_v2`) and the bonding-curve CompleteEvent that marks graduation.
-- Confirm each name and column in Dune's data explorer before the first run; a wrong name
-- fails the query at once and costs nothing.
--
-- {{mcap_bar_usd}} is the stage-2 bar (proposed $25,000 peak market cap); {{peak_since}} the
-- stage-2 start date.

with created as (
  select account_mint as mint, call_block_time as created_at from pumpdotfun_solana.pump_call_create
  union all
  select account_mint, call_block_time from pumpdotfun_solana.pump_call_create_v2
),
graduated as (
  select distinct mint from pumpdotfun_solana.pump_evt_completeevent
)
select
  (select count(*) from created)                                   as launched,
  (select count(*) from graduated)                                 as graduated,
  (select min(created_at) from created)                            as first_launch,
  (select max(created_at) from created)                            as last_launch
