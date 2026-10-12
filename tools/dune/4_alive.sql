-- 4_alive.sql — THE PILOT'S CANDIDATES: launchpad coins, bonded or not, still trading today at a
-- market cap above the bar.
--
-- Today's price from each coin's latest trade in the last {{since_hours}} hours, on the curve
-- (`pumpdotfun`) or its bonded pool (`pumpswap`), from Dune's curated `dex_solana.trades`: the
-- trade's USD value over the coin's side of it. Times the fixed one-billion supply, that is the
-- market cap. It is a CANDIDATE list only: the pilot asks a market source for each coin's market
-- cap now and keeps only the ones that are still above the bar (tools/history-pilot.ts).
--
-- One day of trades, so this scans a day, not history: the cheapest way to ask "which coins are
-- alive". {{mcap_bar_usd}} is policy's `universe.history.aliveMarketCapUsd`.

with launchpad as (
  -- Every launchpad trade is against SOL; the other side is the coin.
  select block_time, amount_usd,
         case when token_sold_mint_address = 'So11111111111111111111111111111111111111112'
              then token_bought_mint_address else token_sold_mint_address end as mint,
         case when token_sold_mint_address = 'So11111111111111111111111111111111111111112'
              then token_bought_amount else token_sold_amount end as token_amount
    from dex_solana.trades
   where project in ('pumpdotfun', 'pumpswap')
     and 'So11111111111111111111111111111111111111112' in (token_sold_mint_address, token_bought_mint_address)
     and block_time >= now() - interval '{{since_hours}}' hour
     and amount_usd > 0
),
latest as (
  select mint, max_by(amount_usd / token_amount, block_time) as price_usd, count(*) as trades
    from launchpad
   where token_amount > 0
   group by mint
)
select mint, price_usd * 1e9 as market_cap_usd, trades
  from latest
 where price_usd * 1e9 >= {{mcap_bar_usd}}
 order by market_cap_usd desc
