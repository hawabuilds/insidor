'use strict';

const { verifyCronAuth } = require('./auth');
const { createTimeGuard } = require('../../../worker/lib/time-guard');
const { loadProgress, saveProgress, clearProgress, recordLastRun } = require('../../../worker/lib/cron-state');
const { loadEnvLocal } = require('../../../worker/lib/env');
const { getServiceClient } = require('../../../worker/lib/supabase');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

async function runCronStage(req, res, stage, runCycleFn) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCronAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  loadEnvLocal();
  const sb = getServiceClient();
  const timeGuard = createTimeGuard();
  const progress = await loadProgress(sb, stage);
  const started = Date.now();

  try {
    const result = await runCycleFn(sb, {
      once: true,
      cron: true,
      timeGuard,
      progress,
    });

    const timedOut = !!(timeGuard.timedOut || result?.timedOut);
    const nextProgress = result?.progress || (timedOut ? progress : {});

    if (timedOut && nextProgress && Object.keys(nextProgress).length) {
      await saveProgress(sb, stage, nextProgress);
    } else if (!timedOut) {
      await clearProgress(sb, stage);
    }

    await recordLastRun(sb, stage);

    return res.status(200).json({
      ok: true,
      stage,
      timedOut,
      elapsedMs: Date.now() - started,
      progress: timedOut ? nextProgress : null,
      result: result && typeof result === 'object' ? { ...result, progress: undefined } : result,
    });
  } catch (e) {
    console.error(`[cron/${stage}]`, e.message);
    return res.status(500).json({
      ok: false,
      stage,
      error: e.message,
      elapsedMs: Date.now() - started,
    });
  }
}

module.exports = { runCronStage, cors };
