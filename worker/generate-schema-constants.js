#!/usr/bin/env node
'use strict';

/**
 * Regenerate lib/db-schema.js from docs/schema.md appendix + documented SQL-only tables.
 * Run: npm run schema:constants
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'schema.md');
const OUT = path.join(ROOT, 'lib', 'db-schema.js');

/** Tables/columns from docs/schema.md (live + SQL migrations). */
const SCHEMA = {
  ingest_near_miss: [
    'first_seen_at', 'last_checked_at', 'likes', 'platform', 'platform_post_id', 'raw', 'views',
  ],
  narrative_posts: [
    'cluster_match', 'ct_pickup', 'filter_label', 'first_seen_at', 'followers', 'handle', 'id',
    'image', 'last_snapshot_at', 'likes', 'media_type', 'media_url', 'narrative_id', 'notable',
    'platform', 'platform_post_id', 'posted_at', 'posted_at_ts', 'pruned_at', 'quotes', 'raw',
    'replies', 'retweets', 'sample_replies', 'snapshot_tier', 'sort_order', 'sound_id',
    'subject_entity', 'text', 'ticker_proposal_count', 'tracking_status', 'views',
  ],
  narrative_tickers: [
    'age_min', 'canonical', 'dex_url', 'endorsed_by', 'first_deployed', 'holders', 'id',
    'liquidity', 'lookup_at', 'mcap', 'mint_ca', 'name', 'narrative_id', 'pump_url', 'safety',
    'smart_money', 'ticker', 'vol24h',
  ],
  narratives: [
    'accel', 'age_min', 'author_velocity', 'blurb', 'bought_reach', 'combined_views', 'created_at',
    'cross_platform', 'ct_pickup', 'display_eligible', 'distinct_authors', 'engagement_velocity',
    'first_seen_at', 'gain_24h', 'gate_reason', 'id', 'img_seed', 'lead_time_min', 'lifecycle',
    'max_meme_score', 'meme_score', 'narr_idx', 'organic_score', 'platforms', 'search_series',
    'source', 'status', 'ticker_proposals', 'title', 'top_post_id', 'trend_direction', 'trend_peak',
    'trend_term', 'updated_at', 'views_velocity',
  ],
  post_embeddings: ['embedding', 'post_id', 'updated_at'],
  post_meme_scores: [
    'engagement_velocity', 'meme_score', 'model', 'post_id', 'raw', 'reason', 'scored_at',
    'suggested_name', 'suggested_ticker', 'velocity', 'views_velocity',
  ],
  post_snapshots: [
    'bookmarks', 'captured_at', 'id', 'likes', 'post_id', 'quotes', 'raw', 'replies', 'retweets',
    'unavailable', 'views',
  ],
  worker_budget_state: [
    'adaptive_floor', 'floor_catch_all', 'floor_media', 'floor_min', 'floor_min_decay_at',
    'floor_slow_burn', 'hourly_tweets', 'hourly_window_start', 'id', 'ingest_underutilised_since',
    'media_lane_pct', 'reads_today', 'updated_at', 'utc_date',
  ],
  worker_crashes: ['id', 'reason', 'stack', 'ts', 'uptime_sec'],
  worker_cron_progress: ['progress', 'stage', 'updated_at'],
  worker_cycle_log: [
    'adaptive_floor', 'budget_note', 'id', 'ingested', 'pruned', 'ran_at', 'reads_consumed',
    'skipped_floor', 'snapshots_written', 'worker',
  ],
  worker_pipeline_state: [
    'anthropic_budget_usd', 'anthropic_spent_usd', 'id', 'ingest_degraded_mode',
    'last_catch_all_at', 'last_health_alarm_at', 'last_heartbeat', 'last_near_miss_at',
    'last_run_cluster', 'last_run_ingest', 'last_run_score', 'last_run_snapshot',
    'last_run_trends', 'last_slow_burn_at', 'pause_reason', 'pipeline_pid',
    'pipeline_started_at', 'projected_daily_usd', 'scoring_paused', 'tt_hashtag_cursor',
    'tt_velocity_unreliable', 'updated_at',
  ],
  worker_trend_cache: ['fetched_at', 'result', 'term'],
  worker_usage: [
    'cost_breakdown', 'cost_usd', 'posts_ingested', 'reads_today', 'source', 'updated_at',
    'utc_date',
  ],
  backtest_runs: ['config', 'finished_at', 'id', 'stage', 'started_at', 'stats', 'status'],
  backtest_tokens: [
    'created_at', 'current_mcap', 'holders', 'id', 'launch_at', 'liquidity_dead_within_24h',
    'liquidity_exists', 'mint', 'name', 'narrative_cohort', 'outcome', 'peak_liquidity', 'peak_mcap',
    'peak_multiple', 'raw', 'run_id', 'source', 'ticker',
  ],
  backtest_candidates: [
    'created_at', 'id', 'match_confidence', 'match_reason', 'matched_platform_post_id',
    'matched_post_at', 'matched_post_raw', 'matched_post_text', 'matched_post_url', 'name_pass',
    'name_reject_reason', 'narrative_cohort', 'outcome', 'post_search_queries', 'run_id', 'status',
    'token_id', 'x_queries_run', 'x_tweets_read',
  ],
  backtest_post_features: [
    'acceleration_t', 'age_min_when_seen', 'author_followers', 'candidate_id', 'created_at',
    'distinct_authors_t', 'engagement_rate_t', 'feature_window_min', 'had_media', 'id',
    'in_narrative_posts', 'meme_score', 'narrative_post_id', 'outcome', 'raw', 'run_id',
    'ticker_proposed_in_replies', 'view_velocity_t', 'views_at_t',
  ],
  backtest_spend_log: ['cost_usd', 'id', 'logged_at', 'note', 'run_id', 'stage', 'tweets_read'],
};

const REL = {
  narrative_posts_narrative_id_fkey: 'narrative_posts_narrative_id_fkey',
};

function render() {
  const lines = [
    "'use strict';",
    '',
    '/**',
    ' * Canonical Supabase table + column names.',
    ' * Source: docs/schema.md — regenerate with `npm run schema:constants`.',
    ' *',
    ' * Use t() / c() / cs() so unknown tables/columns throw at call time.',
    ' */',
    '',
    'const T = Object.freeze({',
  ];

  for (const table of Object.keys(SCHEMA).sort()) {
    lines.push(`  ${table}: '${table}',`);
  }
  lines.push('});');
  lines.push('');
  lines.push('const C = Object.freeze({');

  for (const table of Object.keys(SCHEMA).sort()) {
    lines.push(`  ${table}: Object.freeze({`);
    for (const col of SCHEMA[table]) {
      lines.push(`    ${col}: '${col}',`);
    }
    lines.push('  }),');
  }
  lines.push('});');
  lines.push('');
  lines.push('const REL = Object.freeze({');
  for (const [k, v] of Object.entries(REL)) {
    lines.push(`  ${k}: '${v}',`);
  }
  lines.push('});');
  lines.push('');
  lines.push(`function t(table) {
  if (!Object.prototype.hasOwnProperty.call(T, table)) {
    throw new Error(\`db-schema: unknown table "\${table}"\`);
  }
  return T[table];
}

function c(table, column) {
  const cols = C[table];
  if (!cols) throw new Error(\`db-schema: unknown table "\${table}"\`);
  if (!Object.prototype.hasOwnProperty.call(cols, column)) {
    throw new Error(\`db-schema: unknown column "\${table}.\${column}"\`);
  }
  return cols[column];
}

/** Comma-separated column list for .select() strings. */
function cs(table, ...columns) {
  return columns.map(col => c(table, col)).join(',');
}

/** Map logical keys → validated DB column names for insert/update payloads. */
function row(table, fields) {
  const out = {};
  for (const [key, val] of Object.entries(fields)) {
    out[c(table, key)] = val;
  }
  return out;
}

/** onConflict column list, e.g. onConflictCols('narrative_posts', 'platform', 'platform_post_id') */
function onConflictCols(table, ...columns) {
  return cs(table, ...columns);
}

module.exports = {
  T,
  C,
  REL,
  t,
  c,
  cs,
  row,
  onConflictCols,
};
`);

  return `${lines.join('\n')}\n`;
}

function main() {
  if (!fs.existsSync(DOC)) {
    console.error('[schema:constants] missing', DOC);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, render(), 'utf8');
  console.log(`[schema:constants] wrote ${OUT} (${Object.keys(SCHEMA).length} tables)`);
}

main();
