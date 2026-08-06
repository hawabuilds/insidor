'use strict';

/**
 * Dune SQL — pump.fun graduations + peak multiples via dex_solana.trades.
 * Requires DUNE_API_KEY. Docs: https://docs.dune.com/api-reference/
 */

const fs = require('fs');
const path = require('path');

const DUNE_BASE = 'https://api.dune.com/api/v1';
const PEAK_SQL_PATH = path.join(__dirname, '..', 'dune-peak-multiples.sql');

function graduationSql(lookbackDays) {
  return `
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
  WHERE m.call_block_time >= NOW() - INTERVAL '${lookbackDays}' DAY
    AND m.account_mint LIKE '%pump'
  GROUP BY m.account_mint
) t
ORDER BY graduated_at DESC
`.trim();
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function formatDuneError(err) {
  if (!err) return 'unknown';
  if (typeof err === 'string') return err;
  return err.message || JSON.stringify(err);
}

async function duneFetch(path, { method = 'GET', body, retries = 5 } = {}) {
  const key = process.env.DUNE_API_KEY;
  if (!key) throw new Error('DUNE_API_KEY not set');
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const r = await fetch(`${DUNE_BASE}${path}`, {
      method,
      headers: {
        'X-Dune-Api-Key': key,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
    const msg = json?.error || json?.message || `Dune HTTP ${r.status}`;
    if (r.status === 429 || /too many requests/i.test(String(msg))) {
      const waitMs = Math.min(120_000, 15_000 * (attempt + 1));
      console.log(`[blind] Dune rate limit — waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${retries + 1})`);
      await sleep(waitMs);
      continue;
    }
    if (!r.ok) throw new Error(msg);
    return json;
  }
  throw new Error('Dune rate limit exceeded after retries');
}

function peakMultiplesSql({ gradMaxDays, gradMinDays = 0, tradeLookbackDays }) {
  const raw = fs.readFileSync(PEAK_SQL_PATH, 'utf8');
  const gradMinClause = gradMinDays > 0
    ? `AND m.call_block_time < NOW() - INTERVAL '${gradMinDays}' DAY`
    : '';
  return raw
    .replace(/\{\{grad_max_days\}\}/g, String(gradMaxDays))
    .replace(/\{\{grad_min_clause\}\}/g, gradMinClause)
    .replace(/\{\{trade_lookback_days\}\}/g, String(tradeLookbackDays ?? gradMaxDays))
    .trim();
}

/** 90d full pull split into 30d graduation batches (small tier 2m timeout). */
const PEAK_BATCHES_90D = [
  { gradMaxDays: 30, gradMinDays: 0, tradeLookbackDays: 30 },
  { gradMaxDays: 60, gradMinDays: 30, tradeLookbackDays: 60 },
  { gradMaxDays: 90, gradMinDays: 60, tradeLookbackDays: 90 },
];

async function executeDuneSql(sql, { label = 'Dune SQL', maxWaitMs = 600_000 } = {}) {
  console.log(`[blind] ${label}…`);
  const exec = await duneFetch('/sql/execute', {
    method: 'POST',
    body: {
      sql,
      performance: process.env.DUNE_PERFORMANCE || 'small',
    },
  });
  const executionId = exec.execution_id || exec.executionId;
  if (!executionId) throw new Error('Dune returned no execution_id');
  await waitForExecution(executionId, { maxWaitMs });
  return fetchExecutionRows(executionId);
}

async function waitForExecution(executionId, { maxWaitMs = 300_000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const status = await duneFetch(`/execution/${executionId}/status`);
    const state = status.state || status.status;
    if (state === 'QUERY_STATE_COMPLETED' || state === 'COMPLETED') return executionId;
    if (state === 'QUERY_STATE_FAILED' || state === 'FAILED') {
      throw new Error(`Dune execution failed: ${formatDuneError(status.error)}`);
    }
    await sleep(Number(process.env.DUNE_POLL_MS) || 5000);
  }
  throw new Error('Dune execution timed out');
}

async function fetchExecutionRows(executionId) {
  const out = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const res = await duneFetch(`/execution/${executionId}/results?limit=${limit}&offset=${offset}`);
    const rows = res.result?.rows || res.rows || [];
    out.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }
  return out;
}

function mapDuneRow(row) {
  const mint = row.mint || row.token_mint || row.token_address;
  const grad = row.graduated_at || row.graduated_at_iso;
  const created = row.created_at;
  return {
    mint,
    ticker: row.ticker || row.symbol || null,
    name: row.name || null,
    graduated_at: grad ? new Date(grad).toISOString() : null,
    graduatedMs: grad ? Date.parse(grad) : null,
    created_at: created ? new Date(created).toISOString() : null,
    source: 'dune:pump_graduated',
  };
}

function num(val) {
  if (val == null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function mapPeakRow(row) {
  const grad = row.graduated_at;
  const peakMultiple = num(row.peak_multiple);
  return {
    mint: row.mint,
    ticker: row.ticker || row.symbol || null,
    name: row.name || null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    graduated_at: grad ? new Date(grad).toISOString() : null,
    graduatedMs: grad ? Date.parse(grad) : null,
    first_trade_price: num(row.first_trade_price),
    price_at_graduation: num(row.price_at_graduation),
    price_at_graduation_old: num(row.price_at_graduation_old),
    max_price: num(row.max_price),
    peak_multiple: peakMultiple,
    peak_multiple_old: num(row.peak_multiple_old),
    ath_mcap: num(row.ath_mcap),
    trade_count: num(row.trade_count),
    trades_near_peak: num(row.trades_near_peak),
    source: 'dune:dex_peak',
  };
}

async function discoverGraduatedDune(lookbackDays) {
  const rows = await executeDuneSql(graduationSql(lookbackDays), {
    label: `Dune SQL · last ${lookbackDays}d graduations (pump_call_migrate)`,
  });
  const mapped = rows.map(mapDuneRow).filter(r => r.mint && r.graduatedMs);
  console.log(`[blind] Dune → ${mapped.length} graduated mints`);
  return mapped;
}

async function fetchPeakMultiplesDune(lookbackDays, { startBatch = 0, seedRows = [], onBatchComplete } = {}) {
  const batches = lookbackDays <= 30
    ? [{ gradMaxDays: lookbackDays, gradMinDays: 0, tradeLookbackDays: lookbackDays }]
    : lookbackDays <= 60
      ? [
        { gradMaxDays: 30, gradMinDays: 0, tradeLookbackDays: 30 },
        { gradMaxDays: 60, gradMinDays: 30, tradeLookbackDays: 60 },
      ]
      : PEAK_BATCHES_90D;

  const byMint = new Map();
  for (const row of seedRows) {
    if (row?.mint) byMint.set(row.mint, row);
  }

  const batchGapMs = Number(process.env.DUNE_BATCH_GAP_MS) || 90_000;
  for (let i = startBatch; i < batches.length; i += 1) {
    if (i > 0) {
      console.log(`[blind] waiting ${Math.round(batchGapMs / 1000)}s before batch ${i + 1}/${batches.length}…`);
      await sleep(batchGapMs);
    }

    const batch = batches[i];
    const label = batches.length === 1
      ? `Dune SQL · last ${lookbackDays}d graduations + dex peak multiples`
      : `Dune SQL · batch ${i + 1}/${batches.length} · grads ${batch.gradMinDays}-${batch.gradMaxDays}d`;
    const rows = await executeDuneSql(peakMultiplesSql(batch), {
      label,
      maxWaitMs: Number(process.env.DUNE_MAX_WAIT_MS) || 900_000,
    });
    for (const row of rows) {
      const mapped = mapPeakRow(row);
      if (mapped.mint && mapped.graduatedMs) byMint.set(mapped.mint, mapped);
    }
    console.log(`[blind] batch ${i + 1}/${batches.length} → ${rows.length} rows (${byMint.size} cumulative)`);
    if (onBatchComplete) {
      await onBatchComplete({
        batchIndex: i,
        batchCount: batches.length,
        rows: [...byMint.values()],
        complete: i === batches.length - 1,
      });
    }
  }

  const mapped = [...byMint.values()].sort((a, b) => b.graduatedMs - a.graduatedMs);
  console.log(`[blind] Dune → ${mapped.length} graduated mints · ${mapped.filter(r => r.peak_multiple != null).length} with peak data`);
  return mapped;
}

module.exports = {
  discoverGraduatedDune,
  fetchPeakMultiplesDune,
  graduationSql,
  peakMultiplesSql,
  executeDuneSql,
  PEAK_BATCHES_90D,
};
