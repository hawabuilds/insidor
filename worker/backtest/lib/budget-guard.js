'use strict';

const { t, row: dbRow } = require('../../../lib/db-schema');
const { CONFIG } = require('./config');
const {
  assertCanSpend,
  spendSummary,
  COST_PER_READ,
  MAX_RESULTS,
} = require('../../lib/x-official-adapter');

function isMissingBacktestTable(err) {
  const msg = err?.message || String(err);
  return msg.includes('Could not find the table') || msg.includes('backtest_');
}

async function sumBacktestSpend(sb) {
  const { data, error } = await sb
    .from(t('backtest_spend_log'))
    .select('cost_usd')
    .order('logged_at', { ascending: false })
    .limit(500);
  if (error) {
    if (isMissingBacktestTable(error)) return spendSummary().cost;
    throw new Error('backtest spend log: ' + error.message);
  }
  const logged = (data || []).reduce((s, r) => s + Number(r.cost_usd || 0), 0);
  return Math.max(logged, spendSummary().cost);
}

async function logSpend(sb, { runId, stage, reads, cost, note }) {
  const row = dbRow('backtest_spend_log', {
    run_id: runId || null,
    stage,
    tweets_read: reads,
    cost_usd: cost,
    note: note || null,
    logged_at: new Date().toISOString(),
  });
  const { error } = await sb.from(t('backtest_spend_log')).insert(row);
  if (error && !isMissingBacktestTable(error)) {
    throw new Error('backtest spend insert: ' + error.message);
  }
}

/**
 * Official X API budget only — never touches TwitterAPI.io / pipeline budget.
 */
async function assertOfficialBudget({ stage, projectedReads }) {
  assertCanSpend(projectedReads, { stage });
  const s = spendSummary();
  return { estReads: projectedReads, estCost: projectedReads * COST_PER_READ, spent: s.cost, remaining: s.remaining };
}

async function recordOfficialReads(sb, { runId, stage, reads, cost, note }) {
  if (reads > 0) {
    await logSpend(sb, { runId, stage, reads, cost, note });
  }
}

module.exports = {
  assertOfficialBudget,
  recordOfficialReads,
  logSpend,
  sumBacktestSpend,
  COST_PER_READ,
  MAX_RESULTS,
};
