'use strict';

const { t, c, row: dbRow, onConflictCols } = require('../../lib/db-schema');

const STAGE_LAST_RUN = {
  ingest: 'last_run_ingest',
  snapshot: 'last_run_snapshot',
  score: 'last_run_score',
  cluster: 'last_run_cluster',
  trends: 'last_run_trends',
};

async function loadProgress(sb, stage) {
  const { data, error } = await sb
    .from(t('worker_cron_progress'))
    .select(c('worker_cron_progress', 'progress'))
    .eq(c('worker_cron_progress', 'stage'), stage)
    .maybeSingle();
  if (error && !/worker_cron_progress|schema cache/i.test(error.message)) {
    throw new Error(`loadProgress(${stage}): ${error.message}`);
  }
  return data?.progress && typeof data.progress === 'object' ? data.progress : {};
}

async function saveProgress(sb, stage, progress) {
  const row = dbRow('worker_cron_progress', {
    stage,
    progress: progress || {},
    updated_at: new Date().toISOString(),
  });
  const { error } = await sb
    .from(t('worker_cron_progress'))
    .upsert(row, { onConflict: onConflictCols('worker_cron_progress', 'stage') });
  if (error && !/worker_cron_progress|schema cache/i.test(error.message)) {
    throw new Error(`saveProgress(${stage}): ${error.message}`);
  }
}

async function clearProgress(sb, stage) {
  return saveProgress(sb, stage, {});
}

async function recordLastRun(sb, stage) {
  const col = STAGE_LAST_RUN[stage];
  if (!col) throw new Error(`unknown cron stage: ${stage}`);
  const patch = { [c('worker_pipeline_state', col)]: new Date().toISOString() };
  const { error } = await sb.from(t('worker_pipeline_state')).update(patch).eq(c('worker_pipeline_state', 'id'), 1);
  if (error && !/last_run_|schema cache/i.test(error.message)) {
    throw new Error(`recordLastRun(${stage}): ${error.message}`);
  }
}

async function loadPipelineMemory(sb) {
  const { data, error } = await sb
    .from(t('worker_pipeline_state'))
    .select('*')
    .eq(c('worker_pipeline_state', 'id'), 1)
    .maybeSingle();
  if (error) throw new Error('loadPipelineMemory: ' + error.message);
  return data || {};
}

async function patchPipelineMemory(sb, patch) {
  const { error } = await sb
    .from(t('worker_pipeline_state'))
    .update(dbRow('worker_pipeline_state', { ...patch, updated_at: new Date().toISOString() }))
    .eq(c('worker_pipeline_state', 'id'), 1);
  if (error && !/schema cache/i.test(error.message)) {
    throw new Error('patchPipelineMemory: ' + error.message);
  }
}

function tsToMs(ts) {
  if (!ts) return 0;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : 0;
}

async function loadIngestMemory(sb) {
  const mem = await loadPipelineMemory(sb);
  return {
    lastCatchAll: tsToMs(mem.last_catch_all_at),
    lastSlowBurn: tsToMs(mem.last_slow_burn_at),
    lastNearMiss: tsToMs(mem.last_near_miss_at),
    degradedMode: !!mem.ingest_degraded_mode,
  };
}

async function saveIngestMemory(sb, { lastCatchAll, lastSlowBurn, lastNearMiss, degradedMode }) {
  const patch = {};
  if (lastCatchAll != null) patch.last_catch_all_at = lastCatchAll ? new Date(lastCatchAll).toISOString() : null;
  if (lastSlowBurn != null) patch.last_slow_burn_at = lastSlowBurn ? new Date(lastSlowBurn).toISOString() : null;
  if (lastNearMiss != null) patch.last_near_miss_at = lastNearMiss ? new Date(lastNearMiss).toISOString() : null;
  if (degradedMode != null) patch.ingest_degraded_mode = !!degradedMode;
  if (Object.keys(patch).length) await patchPipelineMemory(sb, patch);
}

async function loadTtHashtagCursor(sb) {
  const mem = await loadPipelineMemory(sb);
  return Number(mem.tt_hashtag_cursor) || 0;
}

async function saveTtHashtagCursor(sb, cursor) {
  await patchPipelineMemory(sb, { tt_hashtag_cursor: Number(cursor) || 0 });
}

async function loadTtVelocityUnreliable(sb) {
  const mem = await loadPipelineMemory(sb);
  return mem.tt_velocity_unreliable === true;
}

async function saveTtVelocityUnreliable(sb, unreliable) {
  await patchPipelineMemory(sb, { tt_velocity_unreliable: unreliable === true });
}

async function loadLastHealthAlarmAt(sb) {
  const mem = await loadPipelineMemory(sb);
  return tsToMs(mem.last_health_alarm_at);
}

async function saveLastHealthAlarmAt(sb, ms) {
  await patchPipelineMemory(sb, {
    last_health_alarm_at: ms ? new Date(ms).toISOString() : null,
  });
}

module.exports = {
  STAGE_LAST_RUN,
  loadProgress,
  saveProgress,
  clearProgress,
  recordLastRun,
  loadPipelineMemory,
  patchPipelineMemory,
  loadIngestMemory,
  saveIngestMemory,
  loadTtHashtagCursor,
  saveTtHashtagCursor,
  loadTtVelocityUnreliable,
  saveTtVelocityUnreliable,
  loadLastHealthAlarmAt,
  saveLastHealthAlarmAt,
  tsToMs,
};
