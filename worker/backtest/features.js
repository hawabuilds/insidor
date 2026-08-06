#!/usr/bin/env node
'use strict';

/**
 * Stage 3 — early-window features (T+30min, no lookahead).
 * Run after Stage 2 retained counts are OK: npm run backtest:features
 */

const { loadEnvLocal } = require('../lib/env');
const { getServiceClient } = require('../lib/supabase');
const { t, c, row: dbRow } = require('../../lib/db-schema');
const { CONFIG, parseArgs } = require('./lib/config');
const { createRun, finishRun, latestRunForStage } = require('./lib/persist');
const { computeFeaturesForCandidate } = require('./lib/features');

async function main() {
  loadEnvLocal();
  const flags = parseArgs();
  const sb = getServiceClient();

  const candRun = flags.runId
    ? { id: flags.runId }
    : await latestRunForStage(sb, 'candidates');
  if (!candRun?.id) throw new Error('No candidates run — run npm run backtest:candidates first');

  const { data: candidates, error } = await sb
    .from(t('backtest_candidates'))
    .select(`*, backtest_tokens (${c('backtest_tokens', 'mint')}, ${c('backtest_tokens', 'ticker')}, ${c('backtest_tokens', 'name')}, ${c('backtest_tokens', 'launch_at')})`)
    .eq(c('backtest_candidates', 'run_id'), candRun.id)
    .eq(c('backtest_candidates', 'status'), 'retained');
  if (error) throw new Error(error.message);

  const runId = await createRun(sb, 'features', { candidateRunId: candRun.id, ...CONFIG });
  console.log(`[backtest:features] run ${runId} · ${candidates?.length || 0} retained candidates`);

  let written = 0;
  for (const cand of candidates || []) {
    const token = cand.backtest_tokens;
    const feats = await computeFeaturesForCandidate(sb, cand, token);
    const row = dbRow('backtest_post_features', {
      run_id: runId,
      candidate_id: cand.id,
      outcome: cand.outcome,
      ...feats,
    });
    const { error: upErr } = await sb
      .from(t('backtest_post_features'))
      .upsert(row, { onConflict: 'run_id,candidate_id' });
    if (upErr) console.warn(`[backtest:features] ${cand.id}: ${upErr.message}`);
    else written += 1;
  }

  await finishRun(sb, runId, { stats: { written, candidates: candidates?.length || 0 } });
  console.log(`[backtest:features] wrote ${written} feature rows`);
  console.log('Next: npm run backtest:report');
}

main().catch(err => {
  console.error('[backtest:features]', err.message || err);
  process.exit(1);
});
