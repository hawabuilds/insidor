#!/usr/bin/env node
'use strict';

/**
 * Remove non-graduated (non-pumpswap) tokens from a tokens run.
 *   npm run backtest:purge -- --run=<tokens_run_id>
 */

const { loadEnvLocal } = require('../lib/env');
const { getServiceClient } = require('../lib/supabase');
const { parseArgs } = require('./lib/config');
const {
  fetchRunById,
  fetchRunTokens,
  deleteTokensByIds,
  countTokensByOutcome,
  finishRun,
  latestRunForStage,
} = require('./lib/persist');
const { exportTokensCsv } = require('./lib/export-csv');
const { isGraduatedPair } = require('./lib/token-source');

function isGraduatedToken(row) {
  const pair = row.raw?.pair;
  if (isGraduatedPair(pair)) return true;
  const dex = row.raw?.lookup?.dexId || row.raw?.lookup?.dex;
  return String(dex || '').toLowerCase() === 'pumpswap';
}

async function resolveRunId(sb, flags) {
  if (flags.runId) return flags.runId;
  const latest = await latestRunForStage(sb, 'tokens');
  if (!latest) throw new Error('No tokens run found');
  return latest.id;
}

async function main() {
  loadEnvLocal();
  const flags = parseArgs();
  const sb = getServiceClient();
  const runId = await resolveRunId(sb, flags);
  const run = await fetchRunById(sb, runId);
  if (!run || run.stage !== 'tokens') throw new Error(`Not a tokens run: ${runId}`);

  const tokens = await fetchRunTokens(sb, runId);
  const toDelete = tokens.filter(row => !isGraduatedToken(row));
  const kept = tokens.length - toDelete.length;

  if (!toDelete.length) {
    console.log(`[backtest:purge] run ${runId} — all ${tokens.length} tokens already graduated`);
    return;
  }

  const byOutcome = { winner: 0, loser: 0, ignored: 0 };
  for (const row of toDelete) byOutcome[row.outcome] = (byOutcome[row.outcome] || 0) + 1;

  console.log(
    `[backtest:purge] run ${runId} — deleting ${toDelete.length} non-pumpswap tokens ` +
    `(W${byOutcome.winner}/L${byOutcome.loser}/I${byOutcome.ignored}) · keeping ${kept}`,
  );

  await deleteTokensByIds(sb, toDelete.map(r => r.id));

  const final = await countTokensByOutcome(sb, runId);
  await finishRun(sb, runId, {
    status: 'partial',
    stats: {
      ...(run.stats || {}),
      purged_non_graduated: toDelete.length,
      winner: final.winner,
      loser: final.loser,
      ignored: final.ignored,
    },
  });

  const exp = await exportTokensCsv(sb, runId);
  console.log(`[backtest:purge] after: W${final.winner} L${final.loser} ignored=${final.ignored}`);
  console.log(`CSV: ${exp.filePath} (${exp.count} rows)`);
}

main().catch(err => {
  console.error('[backtest:purge]', err.message || err);
  process.exit(1);
});
