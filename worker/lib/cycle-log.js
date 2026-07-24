'use strict';

async function logCycle(sb, worker, metrics) {
  const row = {
    worker,
    ran_at: new Date().toISOString(),
    ingested: metrics.ingested ?? null,
    skipped_floor: metrics.skipped_floor ?? null,
    pruned: metrics.pruned ?? null,
    snapshots_written: metrics.snapshots_written ?? null,
    reads_consumed: metrics.reads_consumed ?? null,
    adaptive_floor: metrics.adaptive_floor ?? null,
    budget_note: metrics.budget_note ?? null,
  };

  const { error } = await sb.from('worker_cycle_log').insert(row);
  if (error) console.warn(`[cycle-log] ${worker}:`, error.message);
}

async function latestCycle(sb, worker) {
  const { data, error } = await sb
    .from('worker_cycle_log')
    .select('ingested, skipped_floor, pruned, snapshots_written, ran_at')
    .eq('worker', worker)
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data;
}

module.exports = { logCycle, latestCycle };
