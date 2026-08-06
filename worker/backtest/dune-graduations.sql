-- pump.fun graduations in the last N days (Dune decoded migrate table)
-- Used by: worker/backtest/lib/dune-discovery.js
-- Manual: replace {{lookback_days}} then run on https://dune.com

SELECT
  mint,
  graduated_at,
  created_at,
  ticker,
  name
FROM (
  SELECT
    m.account_mint AS mint,
    MIN(m.call_block_time) AS graduated_at,
    MIN(c.call_block_time) AS created_at,
    MAX(c.symbol) AS ticker,
    MAX(c.name) AS name
  FROM pumpdotfun_solana.pump_call_migrate m
  LEFT JOIN pumpdotfun_solana.pump_call_create c
    ON m.account_mint = c.account_mint
  WHERE m.call_block_time >= NOW() - INTERVAL '{{lookback_days}}' DAY
    AND m.account_mint LIKE '%pump'
  GROUP BY m.account_mint
) t
ORDER BY graduated_at DESC;
