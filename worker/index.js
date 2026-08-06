#!/usr/bin/env node
'use strict';

/**
 * Unified pipeline worker — all stages in one process, independent staggered intervals.
 * Local dev: npm run pipeline
 * Production: Vercel Cron routes in /api/cron/*
 * Dry-run: npm run pipeline -- --dry-run-cost
 */

const { getServiceClient } = require('./lib/supabase');
const { loadEnvLocal } = require('./lib/env');
const { sleep } = require('./lib/retry');
const { logEligibilityLatency } = require('./lib/latency');
const { runDryRunCost, assertStartupBudget } = require('./adapters/anthropic/budget');
const { assertXBudgetConfig } = require('./adapters/x/budget');
const INTERVALS = require('./lib/pipeline-intervals');

const STAGES = [
  {
    name: 'ingest',
    intervalMs: INTERVALS.INGEST_MS,
    offsetMs: 0,
    load: () => require('./ingest/ingest').runCycle,
  },
  {
    name: 'ingest-tiktok',
    intervalMs: INTERVALS.INGEST_TT_MS,
    offsetMs: 30_000,
    load: () => require('./ingest/ingest-tiktok').runCycle,
  },
  {
    name: 'snapshot',
    intervalMs: INTERVALS.SNAPSHOT_MS,
    offsetMs: 15_000,
    load: () => require('./snapshot/snapshotter').runCycle,
  },
  {
    name: 'score',
    intervalMs: INTERVALS.SCORE_MS,
    offsetMs: 45_000,
    load: () => require('./score/score').runCycle,
  },
  {
    name: 'cluster',
    intervalMs: INTERVALS.CLUSTER_MS,
    offsetMs: 90_000,
    load: () => require('./cluster/cluster').runCycle,
  },
  {
    name: 'trends',
    intervalMs: INTERVALS.TRENDS_MS,
    offsetMs: 120_000,
    load: () => require('./trends/trends').runCycle,
  },
];

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

  const sb = getServiceClient();
  const budget = await assertStartupBudget(sb);
  if (!budget.ok) {
    process.exit(1);
  }

  console.log('[pipeline] Insidor Layer 3 — local unified worker');
  console.log(
    `[pipeline] pid ${process.pid} · stages: ingest X every ${INTERVALS.INGEST_MS / 60000}m · ` +
    `ingest-tiktok every ${INTERVALS.INGEST_TT_MS / 60000}m · ` +
    `snapshot ${INTERVALS.SNAPSHOT_MS / 1000}s · score ${INTERVALS.SCORE_MS / 1000}s · ` +
    `cluster ${INTERVALS.CLUSTER_MS / 1000}s · trends ${INTERVALS.TRENDS_MS / 60000}m`,
  );
  console.log('[pipeline] production uses Vercel Cron (/api/cron/*) — see vercel.json');

  await Promise.all(STAGES.map(stage => runStageLoop(sb, stage)));
}

main().catch(async (err) => {
  const stack = err?.stack || String(err);
  console.error(stack);
  process.exit(1);
});
