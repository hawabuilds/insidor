#!/usr/bin/env node
'use strict';

/**
 * Re-run fixed Dune peak query (30d) and report revised winner/loser counts.
 * Run: node worker/backtest/revise-peak-counts.js
 */

const fs = require('fs');
const path = require('path');
const { loadEnvLocal } = require('../lib/env');
const { fetchPeakMultiplesDune } = require('./lib/dune-discovery');
const { BACKTEST_DIR } = require('./lib/blind-csv');

loadEnvLocal();

const WINDOW_DAYS = 30;
const WINNER_PEAK = 10;
const WINNER_ATH = 250_000;
const LOSER_PEAK = 1.5;
const MIN_TRADES_NEAR_PEAK = 3;
const CHECKPOINT = path.join(BACKTEST_DIR, 'backtest2-peak-count-v2-checkpoint.json');

function inWindow(row) {
  return row.graduatedMs >= Date.now() - WINDOW_DAYS * 86_400_000;
}

function isOldWinner(r) {
  return r.peak_multiple_old != null && r.peak_multiple_old >= WINNER_PEAK;
}

function isNewWinnerPeak(r) {
  return r.peak_multiple != null && r.peak_multiple >= WINNER_PEAK;
}

function isStrictWinner(r) {
  return isNewWinnerPeak(r)
    && r.ath_mcap != null
    && r.ath_mcap >= WINNER_ATH
    && r.trades_near_peak != null
    && r.trades_near_peak >= MIN_TRADES_NEAR_PEAK;
}

function isLoser(r) {
  return r.peak_multiple != null && r.peak_multiple < LOSER_PEAK;
}

async function main() {
  console.log(`[revise] fetching peak multiples v2 · last ${WINDOW_DAYS}d…`);
  const started = Date.now();
  const rows = await fetchPeakMultiplesDune(WINDOW_DAYS);
  fs.mkdirSync(BACKTEST_DIR, { recursive: true });
  fs.writeFileSync(CHECKPOINT, `${JSON.stringify({
    lookback_days: WINDOW_DAYS,
    method: 'dune:dex_peak_v2',
    updated_at: new Date().toISOString(),
    elapsed_sec: Number(((Date.now() - started) / 1000).toFixed(1)),
    rows,
    complete: true,
  }, null, 2)}\n`, 'utf8');

  const win = rows.filter(inWindow);
  const oldWinners = win.filter(isOldWinner);
  const newPeakWinners = win.filter(isNewWinnerPeak);
  const strictWinners = win.filter(isStrictWinner);
  const losers = win.filter(isLoser);

  const demotedByGradFix = oldWinners.filter(r => !isNewWinnerPeak(r));
  const gainedByGradFix = newPeakWinners.filter(r => !isOldWinner(r));
  const stillPeakWinner = oldWinners.filter(isNewWinnerPeak);

  const failAth = newPeakWinners.filter(r => r.ath_mcap == null || r.ath_mcap < WINNER_ATH);
  const passAth = newPeakWinners.filter(r => r.ath_mcap != null && r.ath_mcap >= WINNER_ATH);
  const failWash = newPeakWinners.filter(r => (r.trades_near_peak || 0) < MIN_TRADES_NEAR_PEAK);
  const failWashPassAth = failWash.filter(r => r.ath_mcap != null && r.ath_mcap >= WINNER_ATH);

  const examples = [
    '4nwmDscRVqW7gCm3cXFa4JtA4ppns6aWFHuH4KCJpump',
    '7ZuswVUrgBrR8LEn4pAxS5KgyUkLwxiHQzJ5ZZQxpump',
  ];

  console.log(`\n=== FIX 1 · price_at_graduation (pumpswap/raydium post-grad only) ===`);
  console.log(`Old winners (≥${WINNER_PEAK}×, bonding-curve baseline):  ${oldWinners.length}`);
  console.log(`New winners (≥${WINNER_PEAK}×, fixed DEX baseline):        ${newPeakWinners.length}`);
  console.log(`  Still ≥${WINNER_PEAK}× after fix:                        ${stillPeakWinner.length}`);
  console.log(`  Demoted (was ≥${WINNER_PEAK}×, now <${WINNER_PEAK}×):              ${demotedByGradFix.length}`);
  console.log(`  Promoted (was <${WINNER_PEAK}×, now ≥${WINNER_PEAK}×):              ${gainedByGradFix.length}`);

  console.log(`\n=== FIX 2 · ath_mcap >= $${WINNER_ATH.toLocaleString()} ===`);
  console.log(`≥${WINNER_PEAK}× winners passing ath floor:                 ${passAth.length}`);
  console.log(`≥${WINNER_PEAK}× winners failing ath floor:                 ${failAth.length}`);

  console.log(`\n=== FIX 3 · ≥${MIN_TRADES_NEAR_PEAK} trades within 10% of max_price ===`);
  console.log(`≥${WINNER_PEAK}× winners failing wash test:                 ${failWash.length}`);
  console.log(`  …of those pass ath floor (fail wash only):         ${failWashPassAth.length}`);

  console.log(`\n=== REVISED COUNTS (30d window) ===`);
  console.log(`STRICT WINNERS (≥${WINNER_PEAK}× + ath ≥ $250k + wash ok):  ${strictWinners.length}`);
  console.log(`LOSERS (peak < ${LOSER_PEAK}×):                            ${losers.length}`);
  console.log(`Middle:                                              ${win.length - strictWinners.length - losers.length - win.filter(r => r.peak_multiple == null).length}`);
  console.log(`Peak unknown:                                        ${win.filter(r => r.peak_multiple == null).length}`);

  console.log('\n=== EXAMPLES ===');
  for (const mint of examples) {
    const r = win.find(x => x.mint === mint);
    if (!r) continue;
    console.log(`${mint.slice(0, 8)}…`);
    console.log(`  old: ${r.peak_multiple_old?.toFixed(1)}× · new: ${r.peak_multiple?.toFixed(1)}× · ath $${Math.round(r.ath_mcap || 0).toLocaleString()} · near-peak trades ${r.trades_near_peak}`);
    console.log(`  grad price old: ${r.price_at_graduation_old} · fixed: ${r.price_at_graduation}`);
  }

  console.log('\nSTOP — confirm revised counts before sampling 150+150.');
}

main().catch(err => {
  console.error('[revise]', err.message || err);
  process.exit(1);
});
