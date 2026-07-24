'use strict';

/**
 * Shared worker cadence — env-tunable without changing metric gates
 * (MIN_INGEST_VIEWS, meme/cluster thresholds, etc.).
 * More frequent polls → smaller per-cycle read budgets (same daily spend).
 */
const INGEST_MS = Number(process.env.INGEST_POLL_MS) || 10 * 60_000;
const INGEST_TT_MS = Number(process.env.TIKTOK_POLL_MS) || INGEST_MS;

module.exports = {
  INGEST_MS,
  INGEST_TT_MS,
  SNAPSHOT_MS: Number(process.env.SNAPSHOT_POLL_MS) || 60_000,
  SCORE_MS: Number(process.env.SCORE_POLL_MS) || 60_000,
  CLUSTER_MS: Number(process.env.CLUSTER_POLL_MS) || 120_000,
  TRENDS_MS: Number(process.env.TRENDS_POLL_MS) || 45 * 60_000,
};
