#!/usr/bin/env node
'use strict';

/**
 * Stage 1 — pull recent pump.fun tokens, classify WINNER / LOSER (no X API calls).
 * Loops discovery until target sample or max rounds.
 * Run: npm run backtest:tokens
 */

const { loadEnvLocal } = require('../lib/env');
const { getServiceClient } = require('../lib/supabase');
const { CONFIG, parseArgs } = require('./lib/config');
const { runTokensStage, resolveResumeRunId } = require('./lib/run-tokens');

async function main() {
  loadEnvLocal();
  const flags = parseArgs();
  const sb = getServiceClient();
  const resumeRunId = await resolveResumeRunId(sb, flags);
  const { runId, final, counts, ok, fullSample, target, minOk, stats, resumed } = await runTokensStage(sb, {
    loopUntilTarget: true,
    resumeRunId,
  });

  console.log('\n=== STAGE 1 · OUTCOMES — STOP HERE ===');
  console.log(`run_id: ${runId}${resumed ? ' (resumed)' : ''}`);
  console.log(
    `discovery rounds: ${stats.discovery_rounds} · candidates: ${stats.discovered} · ` +
    `enriched: ${counts.processed - counts.skipped} · skipped: ${counts.skipped}`,
  );
  console.log(`WINNER: ${final.winner} · LOSER: ${final.loser} · ignored: ${final.ignored}`);
  console.log(
    `Cohort tags — narrative: ${final.narrative.narrative} · non_narrative: ${final.narrative.non_narrative} · ` +
    `unknown: ${final.narrative.unknown}`,
  );
  console.log(
    `Target ${target}/group (min ${minOk}) · winner ≥${CONFIG.WINNER_PEAK_MULTIPLE}x + ` +
    `(peak liq ≥$${CONFIG.WINNER_PEAK_LIQ_USD} OR peak mcap ≥$${CONFIG.WINNER_PEAK_MCAP_USD})`,
  );
  console.log(`loser <${CONFIG.LOSER_PEAK_MULTIPLE}x OR liq dead within ${CONFIG.LOSER_LIQ_DEAD_HOURS}h`);
  console.log(
    `Stage 2 narrative gate: ≥${CONFIG.MIN_RETAINED_NARRATIVE_PER_GROUP} retained narrative winners AND losers ` +
    `(after X search; non_narrative tokens skipped)`,
  );

  if (fullSample) {
    console.log('\n✓ Full sample OK — run npm run backtest:pipeline or backtest:candidates -- --all');
  } else if (!ok) {
    console.log(`\n⛔ Price-outcome sample too small — need ≥${minOk} winners AND ≥${minOk} losers.`);
    console.log('Try BACKTEST_DISCOVERY=legacy or widen BACKTEST_LOOKBACK_DAYS.');
    process.exitCode = 1;
  } else {
    console.log(`\n⚠ Partial sample (${final.winner}/${final.loser}) — below target ${target}/group but above min ${minOk}.`);
  }
}

main().catch(err => {
  console.error('[backtest:tokens]', err.message || err);
  process.exit(1);
});
