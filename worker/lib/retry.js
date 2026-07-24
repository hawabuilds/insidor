'use strict';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Tenacity-style retry with exponential backoff (+ jitter).
 * Default: retry on HTTP 429 only.
 */
async function withRetry(fn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 6;
  const baseMs = opts.baseMs ?? 1000;
  const maxMs = opts.maxMs ?? 60000;
  const retryOn = opts.retryOn ?? (err => err && err.status === 429);
  const label = opts.label ?? 'request';

  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await fn(attempt);
    } catch (err) {
      const retry = attempt < maxAttempts && retryOn(err);
      if (!retry) throw err;
      const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt - 1));
      const jitter = Math.floor(Math.random() * 400);
      const wait = exp + jitter;
      console.warn(`[retry] ${label}: attempt ${attempt}/${maxAttempts}, waiting ${wait}ms (${err.message})`);
      await sleep(wait);
    }
  }
}

module.exports = { sleep, withRetry };
