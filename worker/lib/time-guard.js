'use strict';

/**
 * Serverless time budget — stop work before Vercel hard-kills the function.
 * Default 50s leaves headroom under a 60s maxDuration.
 */
function createTimeGuard(maxMs = Number(process.env.CRON_MAX_MS) || 50_000) {
  const start = Date.now();
  const deadline = start + maxMs;
  let timedOut = false;

  return {
    start,
    maxMs,
    elapsed() {
      return Date.now() - start;
    },
    remaining() {
      return Math.max(0, deadline - Date.now());
    },
    shouldStop() {
      if (timedOut) return true;
      if (Date.now() >= deadline) {
        timedOut = true;
        return true;
      }
      return false;
    },
    markTimedOut() {
      timedOut = true;
    },
    get timedOut() {
      return timedOut;
    },
  };
}

module.exports = { createTimeGuard };
