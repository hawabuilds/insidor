-- 3_name_only.sql — STAGE 3 (only if asked): every other coin, name only.
--
-- Address, created time, name and ticker — enough to be searchable, status `not_checked_yet`.
-- No metadata read, no check. Paged by {{page_start}}/{{page_end}}. ★ This is the whole
-- launchpad, millions of rows: see the storage note in docs/coin-universe-history-plan.md
-- before running it at all.

select account_mint as mint, call_block_time as created_at, name, symbol
  from pumpdotfun_solana.pump_call_create
 where call_block_time >= timestamp '{{page_start}}' and call_block_time < timestamp '{{page_end}}'
union all
select account_mint, call_block_time, name, symbol
  from pumpdotfun_solana.pump_call_create_v2
 where call_block_time >= timestamp '{{page_start}}' and call_block_time < timestamp '{{page_end}}'
