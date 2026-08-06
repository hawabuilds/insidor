#!/usr/bin/env node
'use strict';

/**
 * STEP 4 — Preview backtest3 extension (60d window, exclude filled backtest2 mints).
 * Run: npm run backtest3:preview
 */

const fs = require('fs');
const path = require('path');
const { loadEnvLocal } = require('../lib/env');
const { fetchPeakMultiplesDune } = require('./lib/dune-discovery');
const { randomSample } = require('./lib/seeded-random');
const { readCsv, BACKTEST_DIR } = require('./lib/blind-csv');

loadEnvLocal();

const WINDOW_DAYS = 60;
const SEED = Number(process.env.BACKTEST2_SEED) || 42;
const WINNER_PEAK = 10;
const WINNER_ATH = 250_000;
const MIN_TRADES_NEAR_PEAK = 3;
const LOSER_PEAK = 1.5;

const FILLED_DEFAULT = path.join(BACKTEST_DIR, 'filled-backtest2-blind-sheet.csv');
const FILLED_DOWNLOADS = path.join(process.env.USERPROFILE || '', 'Downloads', 'filled-backtest2-blind-sheet.csv');
const PEAK_CHECKPOINT = path.join(BACKTEST_DIR, 'backtest3-peak-count-checkpoint.json');
const PREVIEW_META = path.join(BACKTEST_DIR, 'backtest3-preview-meta.json');

function resolveFilledPath() {
  const arg = process.argv.find(a => a.endsWith('.csv'));
  if (arg && fs.existsSync(arg)) return path.resolve(arg);
  if (fs.existsSync(FILLED_DEFAULT)) return FILLED_DEFAULT;
  if (fs.existsSync(FILLED_DOWNLOADS)) return FILLED_DOWNLOADS;
  throw new Error('Filled backtest2 file not found — pass path or copy to backtest/filled-backtest2-blind-sheet.csv');
}

function inWindow(row) {
  return row.graduatedMs >= Date.now() - WINDOW_DAYS * 86_400_000;
}

function isStrictWinner(r) {
  return r.peak_multiple != null
    && r.peak_multiple >= WINNER_PEAK
    && r.ath_mcap != null
    && r.ath_mcap >= WINNER_ATH
    && r.trades_near_peak != null
    && r.trades_near_peak >= MIN_TRADES_NEAR_PEAK;
}

function isLoser(r) {
  return r.peak_multiple != null && r.peak_multiple < LOSER_PEAK;
}

function loadFilledMints(filledPath) {
  const { rows } = readCsv(filledPath);
  const mints = new Set();
  for (const row of rows) {
    let mint = (row.mint || '').trim();
    if (!mint) {
      const m = String(row.pumpfun || '').match(/pump\.fun\/([1-9A-HJ-NP-Za-km-z]{32,44})/);
      mint = m ? m[1] : '';
    }
    if (mint) mints.add(mint);
  }
  return { mints, rowCount: rows.length, filledPath };
}

function selectNewCohort(allRows, excludeMints) {
  const win = allRows.filter(inWindow).filter(r => !excludeMints.has(r.mint));
  const winners = win.filter(isStrictWinner);
  const loserPool = win.filter(isLoser);
  const losers = randomSample(loserPool, winners.length, SEED);
  return { win, winners, loserPool, losers };
}

async function main() {
  const filledPath = resolveFilledPath();
  const preserved = path.join(BACKTEST_DIR, 'filled-backtest2-blind-sheet.csv');
  if (path.resolve(filledPath) !== path.resolve(preserved)) {
    fs.mkdirSync(BACKTEST_DIR, { recursive: true });
    fs.copyFileSync(filledPath, preserved);
    console.log(`[backtest3:preview] preserved filled work → ${preserved}`);
  } else {
    console.log(`[backtest3:preview] using preserved filled file → ${preserved}`);
  }

  const { mints: excludeMints, rowCount: filledRows } = loadFilledMints(preserved);
  console.log(`[backtest3:preview] excluding ${excludeMints.size} mints from filled backtest2 (${filledRows} rows)`);

  console.log(`[backtest3:preview] fetching ${WINDOW_DAYS}d peak multiples from Dune…`);
  const started = Date.now();
  const allRows = await fetchPeakMultiplesDune(WINDOW_DAYS);
  fs.mkdirSync(BACKTEST_DIR, { recursive: true });
  fs.writeFileSync(PEAK_CHECKPOINT, `${JSON.stringify({
    lookback_days: WINDOW_DAYS,
    method: 'dune:dex_peak_v2',
    updated_at: new Date().toISOString(),
    elapsed_sec: Number(((Date.now() - started) / 1000).toFixed(1)),
    rows: allRows,
    complete: true,
  }, null, 2)}\n`, 'utf8');

  const { win, winners, loserPool, losers } = selectNewCohort(allRows, excludeMints);
  const alreadyWinners = allRows.filter(inWindow).filter(r => excludeMints.has(r.mint) && isStrictWinner(r));
  const total60Winners = allRows.filter(inWindow).filter(isStrictWinner).length;

  const preview = {
    generated_at: new Date().toISOString(),
    window_days: WINDOW_DAYS,
    filled_rows_preserved: filledRows,
    excluded_mints: excludeMints.size,
    graduations_60d: allRows.filter(inWindow).length,
    strict_winners_60d_total: total60Winners,
    strict_winners_already_labeled: alreadyWinners.length,
    new_strict_winners: winners.length,
    new_loser_pool: loserPool.length,
    new_losers_sampled: losers.length,
    new_total_rows: winners.length + losers.length,
    seed: SEED,
    winner_criteria: `peak>=${WINNER_PEAK} ath>=${WINNER_ATH} trades_near_peak>=${MIN_TRADES_NEAR_PEAK}`,
    loser_criteria: `peak<${LOSER_PEAK}`,
    new_winner_mints: winners.map(r => r.mint),
    new_loser_mints: losers.map(r => r.mint),
  };
  fs.writeFileSync(PREVIEW_META, `${JSON.stringify(preview, null, 2)}\n`, 'utf8');

  console.log('\n=== BACKTEST3 PREVIEW · 60-DAY EXTENSION ===');
  console.log(`Filled backtest2 (preserved):     ${filledRows} rows · ${excludeMints.size} mints excluded`);
  console.log(`Graduations in 60d window:        ${allRows.filter(inWindow).length}`);
  console.log(`Strict winners in 60d (total):    ${total60Winners}`);
  console.log(`  already in your filled file:    ${alreadyWinners.length}`);
  console.log(`  NEW strict winners:             ${winners.length}`);
  console.log(`NEW losers (sampled to match):    ${losers.length}  (pool ${loserPool.length} · seed ${SEED})`);
  console.log(`NEW total rows if built:          ${winners.length + losers.length}`);
  console.log(`\nPreview saved: ${PREVIEW_META}`);
  console.log(`Peak data saved: ${PEAK_CHECKPOINT}`);
  console.log('\nSTOP — confirm before building backtest3-blind.csv.');
}

main().catch(err => {
  console.error('[backtest3:preview]', err.message || err);
  process.exit(1);
});
