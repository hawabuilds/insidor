'use strict';

/**
 * Build catch-all advanced_search query text.
 * Recency: since_time/until_time as operators inside query (UNIX seconds) — per twitterapi.io docs.
 */
function buildQueries(floor, recencyMin, nowMs = Date.now(), degraded = false) {
  const untilSec = Math.floor(nowMs / 1000);
  const sinceSec = Math.floor((nowMs - recencyMin * 60_000) / 1000);
  const timeOps = `since_time:${sinceSec} until_time:${untilSec}`;
  const ops = `min_faves:${floor} lang:en -filter:replies -filter:retweets ${timeOps}`;

  if (degraded) return [`the ${ops}`];
  return [ops];
}

/** Video/media lane — filter:media catches view-heavy posts. */
function buildMediaQueries(floor, recencyMin, nowMs = Date.now(), degraded = false) {
  const untilSec = Math.floor(nowMs / 1000);
  const sinceSec = Math.floor((nowMs - recencyMin * 60_000) / 1000);
  const timeOps = `since_time:${sinceSec} until_time:${untilSec}`;
  const ops = `min_faves:${floor} filter:media lang:en -filter:replies -filter:retweets ${timeOps}`;

  if (degraded) return [`the ${ops}`];
  return [ops];
}

/** UNIX seconds window — for logging / self-test metadata. */
function recencyWindow(windowMin, nowMs = Date.now()) {
  const untilSec = Math.floor(nowMs / 1000);
  const sinceSec = Math.floor((nowMs - windowMin * 60_000) / 1000);
  return { since_time: sinceSec, until_time: untilSec };
}

module.exports = { buildQueries, buildMediaQueries, recencyWindow };
