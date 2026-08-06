'use strict';

/**
 * Canonical Supabase table + column names.
 * Source: docs/schema.md — regenerate with `npm run schema:constants`.
 *
 * Use t() / c() / cs() so unknown tables/columns throw at call time.
 */

const T = Object.freeze({
  backtest_candidates: 'backtest_candidates',
  backtest_post_features: 'backtest_post_features',
  backtest_runs: 'backtest_runs',
  backtest_spend_log: 'backtest_spend_log',
  backtest_tokens: 'backtest_tokens',
  ingest_near_miss: 'ingest_near_miss',
  narrative_posts: 'narrative_posts',
  narrative_tickers: 'narrative_tickers',
  narratives: 'narratives',
  post_embeddings: 'post_embeddings',
  post_meme_scores: 'post_meme_scores',
  post_snapshots: 'post_snapshots',
  worker_budget_state: 'worker_budget_state',
  worker_crashes: 'worker_crashes',
  worker_cron_progress: 'worker_cron_progress',
  worker_cycle_log: 'worker_cycle_log',
  worker_pipeline_state: 'worker_pipeline_state',
  worker_trend_cache: 'worker_trend_cache',
  worker_usage: 'worker_usage',
});

const C = Object.freeze({
  backtest_candidates: Object.freeze({
    created_at: 'created_at',
    id: 'id',
    match_confidence: 'match_confidence',
    match_reason: 'match_reason',
    matched_platform_post_id: 'matched_platform_post_id',
    matched_post_at: 'matched_post_at',
    matched_post_raw: 'matched_post_raw',
    matched_post_text: 'matched_post_text',
    matched_post_url: 'matched_post_url',
    name_pass: 'name_pass',
    name_reject_reason: 'name_reject_reason',
    narrative_cohort: 'narrative_cohort',
    outcome: 'outcome',
    post_search_queries: 'post_search_queries',
    run_id: 'run_id',
    status: 'status',
    token_id: 'token_id',
    x_queries_run: 'x_queries_run',
    x_tweets_read: 'x_tweets_read',
  }),
  backtest_post_features: Object.freeze({
    acceleration_t: 'acceleration_t',
    age_min_when_seen: 'age_min_when_seen',
    author_followers: 'author_followers',
    candidate_id: 'candidate_id',
    created_at: 'created_at',
    distinct_authors_t: 'distinct_authors_t',
    engagement_rate_t: 'engagement_rate_t',
    feature_window_min: 'feature_window_min',
    had_media: 'had_media',
    id: 'id',
    in_narrative_posts: 'in_narrative_posts',
    meme_score: 'meme_score',
    narrative_post_id: 'narrative_post_id',
    outcome: 'outcome',
    raw: 'raw',
    run_id: 'run_id',
    ticker_proposed_in_replies: 'ticker_proposed_in_replies',
    view_velocity_t: 'view_velocity_t',
    views_at_t: 'views_at_t',
  }),
  backtest_runs: Object.freeze({
    config: 'config',
    finished_at: 'finished_at',
    id: 'id',
    stage: 'stage',
    started_at: 'started_at',
    stats: 'stats',
    status: 'status',
  }),
  backtest_spend_log: Object.freeze({
    cost_usd: 'cost_usd',
    id: 'id',
    logged_at: 'logged_at',
    note: 'note',
    run_id: 'run_id',
    stage: 'stage',
    tweets_read: 'tweets_read',
  }),
  backtest_tokens: Object.freeze({
    created_at: 'created_at',
    current_mcap: 'current_mcap',
    holders: 'holders',
    id: 'id',
    launch_at: 'launch_at',
    liquidity_dead_within_24h: 'liquidity_dead_within_24h',
    liquidity_exists: 'liquidity_exists',
    mint: 'mint',
    name: 'name',
    narrative_cohort: 'narrative_cohort',
    outcome: 'outcome',
    peak_liquidity: 'peak_liquidity',
    peak_mcap: 'peak_mcap',
    peak_multiple: 'peak_multiple',
    raw: 'raw',
    run_id: 'run_id',
    source: 'source',
    ticker: 'ticker',
  }),
  ingest_near_miss: Object.freeze({
    first_seen_at: 'first_seen_at',
    last_checked_at: 'last_checked_at',
    likes: 'likes',
    platform: 'platform',
    platform_post_id: 'platform_post_id',
    raw: 'raw',
    views: 'views',
  }),
  narrative_posts: Object.freeze({
    cluster_match: 'cluster_match',
    ct_pickup: 'ct_pickup',
    filter_label: 'filter_label',
    first_seen_at: 'first_seen_at',
    followers: 'followers',
    handle: 'handle',
    id: 'id',
    image: 'image',
    last_snapshot_at: 'last_snapshot_at',
    likes: 'likes',
    media_type: 'media_type',
    media_url: 'media_url',
    narrative_id: 'narrative_id',
    notable: 'notable',
    platform: 'platform',
    platform_post_id: 'platform_post_id',
    posted_at: 'posted_at',
    posted_at_ts: 'posted_at_ts',
    pruned_at: 'pruned_at',
    quotes: 'quotes',
    raw: 'raw',
    replies: 'replies',
    retweets: 'retweets',
    sample_replies: 'sample_replies',
    snapshot_tier: 'snapshot_tier',
    sort_order: 'sort_order',
    sound_id: 'sound_id',
    subject_entity: 'subject_entity',
    text: 'text',
    ticker_proposal_count: 'ticker_proposal_count',
    tracking_status: 'tracking_status',
    views: 'views',
  }),
  narrative_tickers: Object.freeze({
    age_min: 'age_min',
    canonical: 'canonical',
    dex_url: 'dex_url',
    endorsed_by: 'endorsed_by',
    first_deployed: 'first_deployed',
    holders: 'holders',
    id: 'id',
    liquidity: 'liquidity',
    lookup_at: 'lookup_at',
    mcap: 'mcap',
    mint_ca: 'mint_ca',
    name: 'name',
    narrative_id: 'narrative_id',
    pump_url: 'pump_url',
    safety: 'safety',
    smart_money: 'smart_money',
    ticker: 'ticker',
    vol24h: 'vol24h',
  }),
  narratives: Object.freeze({
    accel: 'accel',
    age_min: 'age_min',
    author_velocity: 'author_velocity',
    blurb: 'blurb',
    bought_reach: 'bought_reach',
    combined_views: 'combined_views',
    created_at: 'created_at',
    cross_platform: 'cross_platform',
    ct_pickup: 'ct_pickup',
    display_eligible: 'display_eligible',
    distinct_authors: 'distinct_authors',
    engagement_velocity: 'engagement_velocity',
    first_seen_at: 'first_seen_at',
    gain_24h: 'gain_24h',
    gate_reason: 'gate_reason',
    id: 'id',
    img_seed: 'img_seed',
    lead_time_min: 'lead_time_min',
    lifecycle: 'lifecycle',
    max_meme_score: 'max_meme_score',
    meme_score: 'meme_score',
    narr_idx: 'narr_idx',
    organic_score: 'organic_score',
    platforms: 'platforms',
    search_series: 'search_series',
    source: 'source',
    status: 'status',
    ticker_proposals: 'ticker_proposals',
    title: 'title',
    top_post_id: 'top_post_id',
    trend_direction: 'trend_direction',
    trend_peak: 'trend_peak',
    trend_term: 'trend_term',
    updated_at: 'updated_at',
    views_velocity: 'views_velocity',
  }),
  post_embeddings: Object.freeze({
    embedding: 'embedding',
    post_id: 'post_id',
    updated_at: 'updated_at',
  }),
  post_meme_scores: Object.freeze({
    engagement_velocity: 'engagement_velocity',
    meme_score: 'meme_score',
    model: 'model',
    post_id: 'post_id',
    raw: 'raw',
    reason: 'reason',
    scored_at: 'scored_at',
    suggested_name: 'suggested_name',
    suggested_ticker: 'suggested_ticker',
    velocity: 'velocity',
    views_velocity: 'views_velocity',
  }),
  post_snapshots: Object.freeze({
    bookmarks: 'bookmarks',
    captured_at: 'captured_at',
    id: 'id',
    likes: 'likes',
    post_id: 'post_id',
    quotes: 'quotes',
    raw: 'raw',
    replies: 'replies',
    retweets: 'retweets',
    unavailable: 'unavailable',
    views: 'views',
  }),
  worker_budget_state: Object.freeze({
    adaptive_floor: 'adaptive_floor',
    floor_catch_all: 'floor_catch_all',
    floor_media: 'floor_media',
    floor_min: 'floor_min',
    floor_min_decay_at: 'floor_min_decay_at',
    floor_slow_burn: 'floor_slow_burn',
    hourly_tweets: 'hourly_tweets',
    hourly_window_start: 'hourly_window_start',
    id: 'id',
    ingest_underutilised_since: 'ingest_underutilised_since',
    media_lane_pct: 'media_lane_pct',
    reads_today: 'reads_today',
    updated_at: 'updated_at',
    utc_date: 'utc_date',
  }),
  worker_crashes: Object.freeze({
    id: 'id',
    reason: 'reason',
    stack: 'stack',
    ts: 'ts',
    uptime_sec: 'uptime_sec',
  }),
  worker_cron_progress: Object.freeze({
    progress: 'progress',
    stage: 'stage',
    updated_at: 'updated_at',
  }),
  worker_cycle_log: Object.freeze({
    adaptive_floor: 'adaptive_floor',
    budget_note: 'budget_note',
    id: 'id',
    ingested: 'ingested',
    pruned: 'pruned',
    ran_at: 'ran_at',
    reads_consumed: 'reads_consumed',
    skipped_floor: 'skipped_floor',
    snapshots_written: 'snapshots_written',
    worker: 'worker',
  }),
  worker_pipeline_state: Object.freeze({
    anthropic_budget_usd: 'anthropic_budget_usd',
    anthropic_spent_usd: 'anthropic_spent_usd',
    id: 'id',
    ingest_degraded_mode: 'ingest_degraded_mode',
    last_catch_all_at: 'last_catch_all_at',
    last_health_alarm_at: 'last_health_alarm_at',
    last_heartbeat: 'last_heartbeat',
    last_near_miss_at: 'last_near_miss_at',
    last_run_cluster: 'last_run_cluster',
    last_run_ingest: 'last_run_ingest',
    last_run_score: 'last_run_score',
    last_run_snapshot: 'last_run_snapshot',
    last_run_trends: 'last_run_trends',
    last_slow_burn_at: 'last_slow_burn_at',
    pause_reason: 'pause_reason',
    pipeline_pid: 'pipeline_pid',
    pipeline_started_at: 'pipeline_started_at',
    projected_daily_usd: 'projected_daily_usd',
    scoring_paused: 'scoring_paused',
    tt_hashtag_cursor: 'tt_hashtag_cursor',
    tt_velocity_unreliable: 'tt_velocity_unreliable',
    updated_at: 'updated_at',
  }),
  worker_trend_cache: Object.freeze({
    fetched_at: 'fetched_at',
    result: 'result',
    term: 'term',
  }),
  worker_usage: Object.freeze({
    cost_breakdown: 'cost_breakdown',
    cost_usd: 'cost_usd',
    posts_ingested: 'posts_ingested',
    reads_today: 'reads_today',
    source: 'source',
    updated_at: 'updated_at',
    utc_date: 'utc_date',
  }),
});

const REL = Object.freeze({
  narrative_posts_narrative_id_fkey: 'narrative_posts_narrative_id_fkey',
});

function t(table) {
  if (!Object.prototype.hasOwnProperty.call(T, table)) {
    throw new Error(`db-schema: unknown table "${table}"`);
  }
  return T[table];
}

function c(table, column) {
  const cols = C[table];
  if (!cols) throw new Error(`db-schema: unknown table "${table}"`);
  if (!Object.prototype.hasOwnProperty.call(cols, column)) {
    throw new Error(`db-schema: unknown column "${table}.${column}"`);
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

