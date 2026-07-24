#!/usr/bin/env node
'use strict';

/**
 * Pipeline supervisor — restart worker on crash with exponential backoff.
 * Run: npm run pipeline
 */

const { spawn } = require('child_process');
const path = require('path');
const { loadEnvLocal } = require('./lib/env');

const MAX_RESTARTS_PER_HOUR = Number(process.env.PIPELINE_MAX_RESTARTS_PER_HOUR) || 5;
const BACKOFF_BASE_MS = Number(process.env.PIPELINE_BACKOFF_BASE_MS) || 5000;
const BACKOFF_MAX_MS = Number(process.env.PIPELINE_BACKOFF_MAX_MS) || 5 * 60_000;
const WINDOW_MS = 60 * 60_000;

const restartTimes = [];
let activeChild = null;
let sigintSeen = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pruneRestartWindow() {
  const cutoff = Date.now() - WINDOW_MS;
  while (restartTimes.length && restartTimes[0] < cutoff) restartTimes.shift();
}

function restartsRemaining() {
  pruneRestartWindow();
  return Math.max(0, MAX_RESTARTS_PER_HOUR - restartTimes.length);
}

function nextBackoffMs(attemptIndex) {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * (2 ** attemptIndex));
}

function spawnWorker(extraArgs) {
  const workerPath = path.join(__dirname, 'index.js');
  const child = spawn(process.execPath, [workerPath, ...extraArgs], {
    stdio: 'inherit',
    env: { ...process.env, PIPELINE_SUPERVISED: '1' },
  });
  activeChild = child;
  return child;
}

function bindSignals() {
  const forward = (signal) => {
    if (activeChild && !activeChild.killed) {
      activeChild.kill(signal);
    }
  };
  process.on('SIGINT', () => {
    sigintSeen = true;
    forward('SIGINT');
  });
  process.on('SIGTERM', () => forward('SIGTERM'));
}

async function main() {
  loadEnvLocal();
  bindSignals();

  const extraArgs = process.argv.slice(2);
  let attemptIndex = 0;

  for (;;) {
    if (sigintSeen) {
      console.log('[supervisor] interrupted — exiting');
      process.exit(0);
    }

    const child = spawnWorker(extraArgs);
    const code = await new Promise((resolve) => {
      child.on('close', (exitCode) => resolve(typeof exitCode === 'number' ? exitCode : 1));
    });
    activeChild = null;

    if (code === 0) {
      console.log('[supervisor] worker exited cleanly (0)');
      process.exit(0);
    }

    if (sigintSeen) {
      console.log('[supervisor] worker stopped after signal');
      process.exit(code || 1);
    }

    pruneRestartWindow();
    if (restartTimes.length >= MAX_RESTARTS_PER_HOUR) {
      console.error(
        `[supervisor] max ${MAX_RESTARTS_PER_HOUR} restarts/hour reached — not restarting (last exit ${code})`,
      );
      process.exit(code || 1);
    }

    restartTimes.push(Date.now());
    const waitMs = nextBackoffMs(attemptIndex);
    attemptIndex += 1;
    const remaining = restartsRemaining();

    console.error(
      `[supervisor] worker exited code ${code} — restart ${restartTimes.length}/${MAX_RESTARTS_PER_HOUR} ` +
      `in ${Math.round(waitMs / 1000)}s (${remaining} left this hour, backoff attempt ${attemptIndex})`,
    );
    await sleep(waitMs);
  }
}

main().catch((err) => {
  console.error('[supervisor] fatal:', err.message || err);
  process.exit(1);
});
