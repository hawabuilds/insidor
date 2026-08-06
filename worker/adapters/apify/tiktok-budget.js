'use strict';

const { t, c, row: dbRow } = require('../../../lib/db-schema');
const { CONFIG: X_BUDGET, utcDateStr, msUntilUtcMidnight } = require('../x/budget');

const CONFIG = {
  TIKTOK_DAILY_BUDGET_USD: Number(process.env.TIKTOK_DAILY_BUDGET) || 2,
  TIKTOK_COST_PER_READ:
    Number(process.env.TIKTOK_COST_PER_READ) ||
    (X_BUDGET.COST_PER_READ * 11),
  POLL_MS:
    Number(process.env.TIKTOK_POLL_MS) ||
    Number(process.env.INGEST_POLL_MS) ||
    10 * 60_000,
  WARN_PCT: 0.80,
  SOURCE: 'tiktok',
};

function maxReadsPerDay() {
  return Math.max(1, Math.floor(CONFIG.TIKTOK_DAILY_BUDGET_USD / CONFIG.TIKTOK_COST_PER_READ));
}

function cycleReadBudget() {
  const cyclesPerDay = Math.max(1, Math.floor(86_400_000 / CONFIG.POLL_MS));
  return Math.max(1, Math.floor(maxReadsPerDay() / cyclesPerDay));
}

function costUsd(reads) {
  return reads * CONFIG.TIKTOK_COST_PER_READ;
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

async function recordUsage(sb, reads, source = CONFIG.SOURCE) {
  if (!reads || reads <= 0) return loadUsage(sb, source);

  const usage = await loadUsage(sb, source);
  const readsToday = (usage.reads_today || 0) + reads;
  const costToday = costUsd(readsToday);

  const { data, error } = await sb
    .from(t('worker_usage'))
    .update(dbRow('worker_usage', {
      reads_today: readsToday,
      cost_usd: costToday,
      updated_at: new Date().toISOString(),
    }))
    .eq(c('worker_usage', 'source'), source)
    .eq(c('worker_usage', 'utc_date'), usage.utc_date)
    .select('*')
    .single();

  if (error) throw new Error(`worker_usage record (${source}): ` + error.message);
  return data;
}

function spendPct(usage) {
  return (usage.reads_today || 0) / maxReadsPerDay();
}

function isDormant(usage) {
  return costUsd(usage.reads_today || 0) >= CONFIG.TIKTOK_DAILY_BUDGET_USD;
}

function isWarn(usage) {
  return spendPct(usage) >= CONFIG.WARN_PCT;
}

function canSpend(usage, n) {
  const nextCost = costUsd((usage.reads_today || 0) + n);
  return nextCost <= CONFIG.TIKTOK_DAILY_BUDGET_USD + 1e-9;
}

function formatBudgetLine(readsThisCycle, usage) {
  const readsToday = usage.reads_today || 0;
  const cost = costUsd(readsToday);
  const pct = ((cost / CONFIG.TIKTOK_DAILY_BUDGET_USD) * 100).toFixed(1);
  return (
    `tiktok cycle · ${readsThisCycle} reads · today ${readsToday.toLocaleString()} reads ` +
    `(~$${cost.toFixed(2)}/$${CONFIG.TIKTOK_DAILY_BUDGET_USD.toFixed(2)}, ${pct}%)`
  );
}

module.exports = {
  CONFIG,
  maxReadsPerDay,
  cycleReadBudget,
  costUsd,
  loadUsage,
  recordUsage,
  spendPct,
  isDormant,
  isWarn,
  canSpend,
  formatBudgetLine,
  msUntilUtcMidnight,
};
