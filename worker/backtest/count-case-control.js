#!/usr/bin/env node
'use strict';

/**
 * STEP 1 — Count graduations with peak_multiple >= threshold by lookback window.
 * Single Dune query (dex_solana.trades) — no per-token API calls.
 * Run: npm run backtest2:count
 * Resume: npm run backtest2:count:resume (reuses cached peak rows if present)
 */

const fs = require('fs');
const path = require('path');
const { loadEnvLocal } = require('../lib/env');
const { fetchPeakMultiplesDune } = require('./lib/dune-discovery');
const { BACKTEST_DIR } = require('./lib/blind-csv');

loadEnvLocal();

const RAN_PEAK = Number(process.env.BACKTEST_RAN_PEAK) || 5;
const FIZZLED_PEAK = Number(process.env.BACKTEST_FIZZLED_PEAK) || 2;
const LOOKBACK_DAYS = Number(process.env.BACKTEST2_LOOKBACK_DAYS) || 90;
const WINDOWS = [30, 60, 90];
const CHECKPOINT_PATH = path.join(BACKTEST_DIR, 'backtest2-peak-count-checkpoint.json');

function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveCheckpoint(state) {
  fs.mkdirSync(BACKTEST_DIR, { recursive: true });
  fs.writeFileSync(CHECKPOINT_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function inWindow(row, days) {
  const cutoff = Date.now() - days * 86_400_000;
  return row.graduatedMs >= cutoff;
}

function summarizeWindow(rows, days) {
  const inWin = rows.filter(r => inWindow(r, days));
  const withPeak = inWin.filter(r => r.peak_multiple != null);
  const ran = inWin.filter(r => r.peak_multiple != null && r.peak_multiple >= RAN_PEAK);
  const fizzled = inWin.filter(r => r.peak_multiple != null && r.peak_multiple < FIZZLED_PEAK);
  const middle = inWin.filter(
    r => r.peak_multiple != null && r.peak_multiple >= FIZZLED_PEAK && r.peak_multiple < RAN_PEAK,
  );
  const unknown = inWin.filter(r => r.peak_multiple == null);
  return {
    days,
    graduations: inWin.length,
    with_peak: withPeak.length,
    ran_gte_5x: ran.length,
    fizzled_lt_2x: fizzled.length,
    middle_2x_to_5x: middle.length,
    peak_unknown: unknown.length,
  };
}

async function main() {
  const resume = process.argv.includes('--resume');
  console.log(`[backtest2:count] RAN ≥${RAN_PEAK}× · FIZZLED <${FIZZLED_PEAK}× · Dune dex peaks · ${LOOKBACK_DAYS}d query`);

  let rows;
  const cp = loadCheckpoint();

  if (resume && cp?.rows?.length && cp.lookback_days === LOOKBACK_DAYS && cp.complete) {
    rows = cp.rows;
    console.log(`[backtest2:count] resume · ${rows.length} peak rows cached (${cp.updated_at})`);
  } else {
    const seedRows = resume && cp?.rows?.length && cp.lookback_days === LOOKBACK_DAYS ? cp.rows : [];
    const startBatch = resume && cp?.batches_complete > 0 && !cp.complete
      ? cp.batches_complete
      : 0;
    if (seedRows.length) {
      console.log(`[backtest2:count] resume · ${seedRows.length} rows from ${startBatch} batches done`);
    } else {
      console.log(`[backtest2:count] fetching ${LOOKBACK_DAYS}d graduations + peaks from Dune (batched)…`);
    }
    const started = Date.now();
    rows = await fetchPeakMultiplesDune(LOOKBACK_DAYS, {
      startBatch,
      seedRows,
      onBatchComplete: async ({ batchIndex, batchCount, rows: batchRows, complete }) => {
        saveCheckpoint({
          lookback_days: LOOKBACK_DAYS,
          method: 'dune:dex_solana.trades',
          updated_at: new Date().toISOString(),
          batches_complete: batchIndex + 1,
          batch_count: batchCount,
          rows: batchRows,
          complete,
        });
      },
    });
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    saveCheckpoint({
      lookback_days: LOOKBACK_DAYS,
      method: 'dune:dex_solana.trades',
      updated_at: new Date().toISOString(),
      elapsed_sec: Number(elapsed),
      batches_complete: rows.length ? (cp?.batch_count || 3) : 0,
      rows,
      complete: true,
    });
    console.log(`[backtest2:count] Dune batches finished in ${elapsed}s`);
  }

  console.log('\n=== BACKTEST2 STEP 1 — GRADUATION COUNTS BY WINDOW ===');
  console.log(`Dune graduations (${LOOKBACK_DAYS}d query): ${rows.length}`);
  console.log(`Peak data: ${rows.filter(r => r.peak_multiple != null).length}`);
  console.log('Method: dex_solana.trades (pumpdotfun + pumpswap) · max_price / price_at_graduation');
  console.log('');

  for (const days of WINDOWS) {
    const s = summarizeWindow(rows, days);
    console.log(`--- Last ${days} days ---`);
    console.log(`  Graduations:        ${s.graduations}`);
    console.log(`  Peak known:         ${s.with_peak}`);
    console.log(`  RAN (≥${RAN_PEAK}×):          ${s.ran_gte_5x}  ← winner pool (case-control)`);
    console.log(`  FIZZLED (<${FIZZLED_PEAK}×):       ${s.fizzled_lt_2x}  ← loser pool`);
    console.log(`  Middle (${FIZZLED_PEAK}×–${RAN_PEAK}×):     ${s.middle_2x_to_5x}`);
    console.log(`  Peak unknown:       ${s.peak_unknown}`);
    console.log('');
  }

  console.log('STOP — pick a window (30 / 60 / 90 days) before building backtest2-blind.csv.');
}

main().catch(err => {
  console.error('[backtest2:count]', err.message || err);
  process.exit(1);
});
