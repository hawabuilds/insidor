#!/usr/bin/env node
'use strict';

/**
 * Unified pipeline worker — all stages in one process, independent staggered intervals.
 * Normally started by worker/supervisor.js (npm run pipeline).
 * Direct: npm run pipeline:worker
 * Dry-run: npm run pipeline -- --dry-run-cost
 */

const { getServiceClient } = require('./lib/supabase');
const { loadEnvLocal } = require('./lib/env');
const { sleep } = require('./lib/retry');
const { logEligibilityLatency } = require('./lib/latency');
const { acquirePipelineLock, releasePipelineLock } = require('./lib/pipeline-lock');
const { bindFatalHandlers, recordCrash } = require('./lib/pipeline-crash');
const { startHeartbeat, touchHeartbeat } = require('./lib/pipeline-heartbeat');
const { runDryRunCost, assertStartupBudget } = require('./lib/anthropic-budget');
const { assertXBudgetConfig } = require('./lib/budget');
const INTERVALS = require('./lib/pipeline-intervals');

bindFatalHandlers();

const STAGES = [
  {
    name: 'ingest',
    intervalMs: INTERVALS.INGEST_MS,
    offsetMs: 0,
    load: () => require('./ingest').runCycle,
  },
  {
    name: 'ingest-tiktok',
    intervalMs: INTERVALS.INGEST_TT_MS,
    offsetMs: 30_000,
    load: () => require('./ingest-tiktok').runCycle,
  },
  {
    name: 'snapshot',
    intervalMs: INTERVALS.SNAPSHOT_MS,
    offsetMs: 15_000,
    load: () => require('./snapshotter').runCycle,
  },
  {
    name: 'score',
    intervalMs: INTERVALS.SCORE_MS,
    offsetMs: 45_000,
    load: () => require('./score').runCycle,
  },
  {
    name: 'cluster',
    intervalMs: INTERVALS.CLUSTER_MS,
    offsetMs: 90_000,
    load: () => require('./cluster').runCycle,
  },
  {
    name: 'trends',
    intervalMs: INTERVALS.TRENDS_MS,
    offsetMs: 120_000,
    load: () => require('./trends').runCycle,
  },
];

function bindLockCleanup() {
  const cleanup = () => {
    releasePipelineLock();
  };
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
  process.on('exit', cleanup);
}

async function runStageLoop(sb, stage) {
  const runCycle = stage.load();
  await sleep(stage.offsetMs);
  console.log(
    `[pipeline] ${stage.name} loop started — every ${Math.round(stage.intervalMs / 1000)}s ` +
    `(offset ${Math.round(stage.offsetMs / 1000)}s)`,
  );

  for (;;) {
    const started = Date.now();
    try {
      await runCycle(sb);
    } catch (e) {
      console.error(`[pipeline] ${stage.name} cycle error:`, e.message);
    }
    try {
      await logEligibilityLatency(sb, stage.name);
    } catch (e) {
      console.warn(`[pipeline] ${stage.name} latency log failed:`, e.message);
    }
    const elapsed = Date.now() - started;
    const wait = Math.max(0, stage.intervalMs - elapsed);
    if (wait) await sleep(wait);
  }
}

async function main() {
  loadEnvLocal();

  if (process.argv.includes('--dry-run-cost')) {
    const sb = getServiceClient();
    await runDryRunCost(sb);
    return;
  }

  try {
    assertXBudgetConfig();
  } catch (e) {
    console.error(`[pipeline] ${e.message}`);
    process.exit(1);
  }

  try {
    acquirePipelineLock();
  } catch (e) {
    if (e.code === 'PIPELINE_LOCKED') {
      console.error(`[pipeline] ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
  bindLockCleanup();

  const sb = getServiceClient();
  const budget = await assertStartupBudget(sb);
  if (!budget.ok) {
    releasePipelineLock();
    process.exit(1);
  }

  const pipelineStartedAt = new Date().toISOString();
  let stopHeartbeat = () => {};
  try {
    await touchHeartbeat(sb, { pipeline_started_at: pipelineStartedAt });
    stopHeartbeat = startHeartbeat(sb);
  } catch (e) {
    console.warn('[pipeline] initial heartbeat failed (apply schema:pipeline-reliability?):', e.message);
  }

  const supervised = process.env.PIPELINE_SUPERVISED === '1';
  console.log('[pipeline] Insidor Layer 3 — unified worker');
  console.log(
    `[pipeline] pid ${process.pid}${supervised ? ' (supervised)' : ''} · heartbeat every 60s · ` +
    `stages: ingest X every ${INTERVALS.INGEST_MS / 60000}m · ` +
    `ingest-tiktok every ${INTERVALS.INGEST_TT_MS / 60000}m · ` +
    `snapshot ${INTERVALS.SNAPSHOT_MS / 1000}s · score ${INTERVALS.SCORE_MS / 1000}s · ` +
    `cluster ${INTERVALS.CLUSTER_MS / 1000}s · trends ${INTERVALS.TRENDS_MS / 60000}m`,
  );

  try {
    await Promise.all(STAGES.map(stage => runStageLoop(sb, stage)));
  } finally {
    stopHeartbeat();
  }
}

main().catch(async (err) => {
  releasePipelineLock();
  const stack = err?.stack || String(err);
  console.error(stack);
  await recordCrash('main.catch', stack).catch(() => {});
  process.exit(1);
});
