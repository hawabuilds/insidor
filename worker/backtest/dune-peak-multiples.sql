-- Peak multiples for pump.fun graduations via dex_solana.trades
-- Params: grad_max_days, grad_min_days (0 = no upper bound), trade_lookback_days
--
-- price_at_graduation = first pumpswap/raydium trade AT OR AFTER graduation (never bonding curve)
-- peak_multiple       = max_price / price_at_graduation
-- ath_mcap            = max_price * 1e9  (fixed 1B pump.fun supply)
-- trades_near_peak    = trades with price >= 90% of max_price (wash-trade guard)

WITH grads AS (
  SELECT
    m.account_mint AS mint,
    MIN(m.call_block_time) AS graduated_at,
    MIN(c.call_block_time) AS created_at,
    MAX(c.symbol) AS ticker,
    MAX(c.name) AS name
  FROM pumpdotfun_solana.pump_call_migrate m
  LEFT JOIN pumpdotfun_solana.pump_call_create c
    ON m.account_mint = c.account_mint
  WHERE m.call_block_time >= NOW() - INTERVAL '{{grad_max_days}}' DAY
    AND m.account_mint LIKE '%pump'
    {{grad_min_clause}}
  GROUP BY m.account_mint
),

mint_trades AS (
  SELECT
    t.block_time,
    t.amount_usd,
    t.token_bought_mint_address AS mint,
    t.token_bought_amount AS token_amount,
    t.project
  FROM dex_solana.trades t
  INNER JOIN grads g ON g.mint = t.token_bought_mint_address
  WHERE t.block_time >= NOW() - INTERVAL '{{trade_lookback_days}}' DAY
    AND t.project IN ('pumpdotfun', 'pumpswap', 'raydium')
    AND t.amount_usd > 0
    AND t.token_bought_amount > 0

  UNION ALL

  SELECT
    t.block_time,
    t.amount_usd,
    t.token_sold_mint_address AS mint,
    t.token_sold_amount AS token_amount,
    t.project
  FROM dex_solana.trades t
  INNER JOIN grads g ON g.mint = t.token_sold_mint_address
  WHERE t.block_time >= NOW() - INTERVAL '{{trade_lookback_days}}' DAY
    AND t.project IN ('pumpdotfun', 'pumpswap', 'raydium')
    AND t.amount_usd > 0
    AND t.token_sold_amount > 0
),

trades_priced AS (
  SELECT
    g.mint,
    g.graduated_at,
    mt.block_time,
    mt.project,
    mt.amount_usd,
    mt.amount_usd / NULLIF(mt.token_amount, 0) AS price_usd
  FROM mint_trades mt
  INNER JOIN grads g ON g.mint = mt.mint
),

agg AS (
  SELECT
    mint,
    MAX(price_usd) AS max_price,
    min_by(price_usd, block_time) FILTER (
      WHERE block_time >= graduated_at
    ) AS price_at_graduation_old,
    min_by(price_usd, block_time) FILTER (
      WHERE block_time >= graduated_at
        AND project IN ('pumpswap', 'raydium')
        AND amount_usd >= 10
    ) AS price_at_graduation,
    min_by(price_usd, block_time) AS first_trade_price,
    COUNT(*) AS trade_count
  FROM trades_priced
  GROUP BY mint
),

peak_support AS (
  SELECT
    tp.mint,
    COUNT(*) AS trades_near_peak
  FROM trades_priced tp
  INNER JOIN agg a ON tp.mint = a.mint
  WHERE a.max_price IS NOT NULL
    AND tp.price_usd >= a.max_price * 0.9
  GROUP BY tp.mint
)

SELECT
  g.mint,
  g.ticker,
  g.name,
  g.created_at,
  g.graduated_at,
  a.first_trade_price,
  a.price_at_graduation_old,
  a.price_at_graduation,
  a.max_price,
  a.max_price / NULLIF(a.price_at_graduation_old, 0) AS peak_multiple_old,
  a.max_price / NULLIF(a.price_at_graduation, 0) AS peak_multiple,
  a.max_price * 1000000000 AS ath_mcap,
  a.trade_count,
  COALESCE(ps.trades_near_peak, 0) AS trades_near_peak
FROM grads g
LEFT JOIN agg a ON g.mint = a.mint
LEFT JOIN peak_support ps ON g.mint = ps.mint
ORDER BY g.graduated_at DESC
