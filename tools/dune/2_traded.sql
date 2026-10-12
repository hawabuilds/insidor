-- 2_traded.sql — STAGE 2: coins that did NOT bond but were really traded.
--
-- "Really traded" is a volume bar AND a trader bar, both from the curve's own trade events:
-- total SOL through the curve at least {{volume_bar_sol}}, from at least {{trader_bar}} distinct
-- wallets. A coin one wallet pumped and dumped clears the first bar and not the second; a coin
-- fifty wallets each bought a cent of clears the second and not the first. Neither alone is a
-- market. Holders would be the better bar and cost a scan of every token balance; distinct
-- traders is the same idea from the table this query already reads.
--
-- One row per coin with what we store and nothing more: address, launch time, name, ticker and
-- metadata link. The picture is read from the metadata through our own gateway, as in 3.1.
--
-- ★ THIS IS THE EXPENSIVE QUERY: it scans every trade on the curve. Paged by
-- {{page_start}}/{{page_end}} on LAUNCH time, so each page reads the trades of one month's
-- launches and a stopped run resumes at the next month. Check the table names first — see
-- 0_counts.sql.

with created as (
  select account_mint as mint, call_block_time as created_at, name, symbol, uri
    from pumpdotfun_solana.pump_call_create
   where call_block_time >= timestamp '{{page_start}}' and call_block_time < timestamp '{{page_end}}'
  union all
  select account_mint, call_block_time, name, symbol, uri
    from pumpdotfun_solana.pump_call_create_v2
   where call_block_time >= timestamp '{{page_start}}' and call_block_time < timestamp '{{page_end}}'
),
traded as (
  select t.mint,
         sum(cast(t.sol_amount as double)) / 1e9 as volume_sol,
         count(distinct t."user") as traders
    from pumpdotfun_solana.pump_evt_tradeevent t
    join created c on c.mint = t.mint
   where t.evt_block_time >= timestamp '{{page_start}}'
   group by t.mint
)
select c.mint, c.created_at, c.name, c.symbol, c.uri, t.volume_sol, t.traders
  from created c
  join traded t on t.mint = c.mint
 where t.volume_sol >= {{volume_bar_sol}}
   and t.traders >= {{trader_bar}}
   and c.mint not in (select mint from pumpdotfun_solana.pump_evt_completeevent)
 order by t.volume_sol desc
