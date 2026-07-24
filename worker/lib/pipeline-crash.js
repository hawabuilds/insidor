'use strict';

const { getServiceClient } = require('./supabase');
const { releasePipelineLock } = require('./pipeline-lock');

const startedAtMs = Date.now();
let handlersBound = false;
let shuttingDown = false;

async function recordCrash(reason, stack) {
  try {
    const sb = getServiceClient();
    const { error } = await sb.from('worker_crashes').insert({
      reason: String(reason).slice(0, 500),
      stack: stack ? String(stack).slice(0, 32_000) : null,
      uptime_sec: Math.round((Date.now() - startedAtMs) / 1000),
    });
    if (error) console.error('[pipeline] worker_crashes insert failed:', error.message);
  } catch (e) {
    console.error('[pipeline] worker_crashes record failed:', e.message);
  }
}

function fatalExit(kind, err) {
  if (shuttingDown) return;
  shuttingDown = true;

  const stack = err?.stack || (err instanceof Error ? err.message : String(err));
  console.error(`[pipeline] FATAL ${kind}`);
  console.error(stack);

  const done = () => {
    try {
      releasePipelineLock();
    } catch (_) { /* ignore */ }
    process.exit(1);
  };

  recordCrash(kind, stack)
    .catch(() => {})
    .finally(done);

  setTimeout(done, 8000).unref();
}

function bindFatalHandlers() {
  if (handlersBound) return;
  handlersBound = true;

  process.on('uncaughtException', (err) => {
    fatalExit('uncaughtException', err);
  });

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    fatalExit('unhandledRejection', err);
  });
}

module.exports = {
  bindFatalHandlers,
  recordCrash,
  getUptimeSec: () => Math.round((Date.now() - startedAtMs) / 1000),
};
