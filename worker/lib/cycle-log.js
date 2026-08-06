'use strict';

const { t, c, cs, row: dbRow } = require('../../lib/db-schema');

async function logCycle(sb, worker, metrics) {
  const row = dbRow('worker_cycle_log', {
    worker,
    ran_at: new Date().toISOString(),
    ingested: metrics.ingested ?? null,
    skipped_floor: metrics.skipped_floor ?? null,
    pruned: metrics.pruned ?? null,
    snapshots_written: metrics.snapshots_written ?? null,
    reads_consumed: metrics.reads_consumed ?? null,
    adaptive_floor: metrics.adaptive_floor ?? null,
    budget_note: metrics.budget_note ?? null,
  });

  const { error } = await sb.from(t('worker_cycle_log')).insert(row);
  if (error) console.warn(`[cycle-log] ${worker}:`, error.message);
}

async function latestCycle(sb, worker) {
  const { data, error } = await sb
    .from(t('worker_cycle_log'))
    .select(cs('worker_cycle_log', 'ingested', 'skipped_floor', 'pruned', 'snapshots_written', 'ran_at'))
    .eq(c('worker_cycle_log', 'worker'), worker)
    .order(c('worker_cycle_log', 'ran_at'), { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data;
}

module.exports = { logCycle, latestCycle };
