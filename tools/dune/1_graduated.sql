-- 1_graduated.sql — STAGE 1: every coin that graduated, since the launchpad began.
--
-- One row per coin: its address, when it was created and graduated, the name, ticker and
-- metadata link its creator wrote, and the creator's wallet. The metadata document itself is
-- NOT fetched by Dune: the import reads it by content id through our own gateway, as 3.1 does.
--
-- Paged by {{page_start}}/{{page_end}} (created_at), so a run is resumable and each page is a
-- known size. Check the table names first — see 0_counts.sql.

with created as (
  select account_mint as mint, call_block_time as created_at, call_tx_id as create_tx,
         name, symbol, uri, account_user as creator
    from pumpdotfun_solana.pump_call_create
  union all
  select account_mint, call_block_time, call_tx_id, name, symbol, uri, account_user
    from pumpdotfun_solana.pump_call_create_v2
),
graduated as (
  select mint, min(evt_block_time) as graduated_at
    from pumpdotfun_solana.pump_evt_completeevent
   group by mint
)
select c.mint, c.created_at, g.graduated_at, c.name, c.symbol, c.uri, c.creator, c.create_tx
  from created c
  join graduated g on g.mint = c.mint
 where c.created_at >= timestamp '{{page_start}}'
   and c.created_at <  timestamp '{{page_end}}'
 order by c.created_at
