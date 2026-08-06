'use strict';

const { t, c, row: dbRow } = require('../../../lib/db-schema');
const { utcDateStr, msUntilUtcMidnight } = require('../x/budget');

const CONFIG = {
  DAILY_BUDGET_USD: Number(process.env.APIFY_DAILY_BUDGET) || 1,
  COST_PER_RUN: Number(process.env.APIFY_COST_PER_RUN) || 0.05,
  COST_PER_ITEM:
    Number(process.env.APIFY_COST_PER_ITEM) ||
    Number(process.env.TIKTOK_COST_PER_READ) ||
    0.00165,
  WARN_PCT: Number(process.env.APIFY_WARN_PCT) || 0.8,
  SOURCE: 'apify',
};

const DORMANT_ALARM_MS = 60 * 60 * 1000;
let lastDormantAlarmAt = 0;

function costForRun(itemCount = 0, runs = 1) {
  const items = Math.max(0, Number(itemCount) || 0);
  const nRuns = Math.max(1, Number(runs) || 1);
  return nRuns * CONFIG.COST_PER_RUN + items * CONFIG.COST_PER_ITEM;
}

function estimateInputItems(input = {}) {
  if (Array.isArray(input.postURLs) && input.postURLs.length) {
    return input.postURLs.length;
  }
  if (input.resultsPerPage) return Number(input.resultsPerPage);
  if (Array.isArray(input.searchQueries) && input.searchQueries.length) {
    return input.searchQueries.length * Math.max(3, Number(input.resultsPerPage) || 10);
  }
  if (Array.isArray(input.hashtags) && input.hashtags.length) {
    return input.hashtags.length * Math.max(3, Number(input.resultsPerPage) || 10);
  }
  return 1;
}

function costToday(usage) {
  return Number(usage?.cost_usd) || 0;
}

function runsToday(usage) {
  return Number(usage?.reads_today) || 0;
}

async function loadUsage(sb, source = CONFIG.SOURCE) {
  const today = utcDateStr();
  const { data, error } = await sb
    .from(t('worker_usage'))
    .select('*')
    .eq(c('worker_usage', 'source'), source)
    .eq(c('worker_usage', 'utc_date'), today)
    .maybeSingle();

  if (error) throw new Error(`worker_usage load (${source}): ` + error.message);

  if (!data) {
    const row = dbRow('worker_usage', {
      source,
      utc_date: today,
      reads_today: 0,
      cost_usd: 0,
      updated_at: new Date().toISOString(),
    });
    const { error: insErr } = await sb.from(t('worker_usage')).insert(row);
    if (insErr) throw new Error(`worker_usage insert (${source}): ` + insErr.message);
    return row;
  }

  return data;
}

async function recordRun(sb, meta = {}, source = CONFIG.SOURCE) {
  const itemCount = Math.max(0, Number(meta.itemCount) || 0);
  const runs = Math.max(1, Number(meta.runs) || 1);
  const cost = costForRun(itemCount, runs);
  const usage = await loadUsage(sb, source);
  const nextRuns = runsToday(usage) + runs;
  const nextCost = costToday(usage) + cost;

  const { data, error } = await sb
    .from(t('worker_usage'))
    .update(dbRow('worker_usage', {
      reads_today: nextRuns,
      cost_usd: nextCost,
      updated_at: new Date().toISOString(),
    }))
    .eq(c('worker_usage', 'source'), source)
    .eq(c('worker_usage', 'utc_date'), usage.utc_date)
    .select('*')
    .single();

  if (error) throw new Error(`worker_usage record (${source}): ` + error.message);

  const actor = meta.actorId ? ` actor=${meta.actorId}` : '';
  console.log(
    `[apify-budget] run +$${cost.toFixed(4)} (${runs} run, ${itemCount} items${actor}) · ` +
    `today $${nextCost.toFixed(2)}/$${CONFIG.DAILY_BUDGET_USD.toFixed(2)} (${nextRuns} runs)`,
  );

  if (isDormant(data)) logDormantAlarm(data);
  return data;
}

function spendPct(usage) {
  if (!CONFIG.DAILY_BUDGET_USD) return 1;
  return costToday(usage) / CONFIG.DAILY_BUDGET_USD;
}

function isDormant(usage) {
  return costToday(usage) >= CONFIG.DAILY_BUDGET_USD - 1e-9;
}

function isWarn(usage) {
  return spendPct(usage) >= CONFIG.WARN_PCT;
}

function canSpend(usage, estimatedCostUsd) {
  return costToday(usage) + estimatedCostUsd <= CONFIG.DAILY_BUDGET_USD + 1e-9;
}

function logDormantAlarm(usage) {
  const now = Date.now();
  if (lastDormantAlarmAt && now - lastDormantAlarmAt < DORMANT_ALARM_MS) return;
  lastDormantAlarmAt = now;
  const spent = costToday(usage);
  const pct = ((spent / CONFIG.DAILY_BUDGET_USD) * 100).toFixed(1);
  console.error(
    '\n' + '='.repeat(72) + '\n' +
    '  APIFY DAILY BUDGET EXHAUSTED — all Apify actors dormant until UTC midnight\n' +
    `  spent $${spent.toFixed(2)}/$${CONFIG.DAILY_BUDGET_USD.toFixed(2)} (${pct}%) · ` +
    `${runsToday(usage)} runs today\n` +
    '='.repeat(72) + '\n',
  );
}

function formatBudgetLine(meta = {}, usage) {
  const spent = costToday(usage);
  const pct = ((spent / CONFIG.DAILY_BUDGET_USD) * 100).toFixed(1);
  const tail = meta.actorId ? ` · last=${meta.actorId}` : '';
  return (
    `apify · ${runsToday(usage)} runs · today ~$${spent.toFixed(2)}/` +
    `$${CONFIG.DAILY_BUDGET_USD.toFixed(2)} (${pct}%)${tail}`
  );
}

module.exports = {
  CONFIG,
  costForRun,
  estimateInputItems,
  loadUsage,
  recordRun,
  spendPct,
  isDormant,
  isWarn,
  canSpend,
  logDormantAlarm,
  formatBudgetLine,
  msUntilUtcMidnight,
};
