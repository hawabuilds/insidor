-- 2_above_bar.sql — STAGE 2: coins that did NOT graduate but reached the market-cap bar,
-- biggest first.
--
-- Peak market cap from the bonding curve's own trade events: price = virtual SOL reserves /
-- virtual token reserves, times the fixed one-billion supply, times SOL's USD price at the
-- minute of the trade. ★ THIS IS THE EXPENSIVE QUERY: it scans every trade on the curve. It is
-- paged by {{page_start}}/{{page_end}} (trade time) so each run reads one window, and pages are
-- merged by keeping each coin's highest peak.
--
-- {{mcap_bar_usd}}: the bar (proposed $25,000). Check the table names first — see 0_counts.sql.

with peaks as (
  select t.mint,
         max((cast(t.virtual_sol_reserves as double) / cast(t.virtual_token_reserves as double))
             * 1e9 * p.price) as peak_mcap_usd
    from pumpdotfun_solana.pump_evt_tradeevent t
    join prices.usd p
      on p.blockchain = 'solana' and p.symbol = 'SOL'
     and p.minute = date_trunc('minute', t.evt_block_time)
   where t.evt_block_time >= timestamp '{{page_start}}'
     and t.evt_block_time <  timestamp '{{page_end}}'
   group by t.mint
)
select p.mint, p.peak_mcap_usd
  from peaks p
 where p.peak_mcap_usd >= {{mcap_bar_usd}}
   and p.mint not in (select mint from pumpdotfun_solana.pump_evt_completeevent)
 order by p.peak_mcap_usd desc
