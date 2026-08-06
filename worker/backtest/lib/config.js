'use strict';

const { loadEnvLocal } = require('../../lib/env');
loadEnvLocal();

const DEFAULT_SEED_MINTS = [
  'HB7MPRYpegrJaJtsZvrXAEHx5kxdehiQQUNneVLnpump',
  'GD8cdLqU3HU8FfsQDAKU1vDrewciZC2WgRfs2yAspump',
];

function parseSeedMints() {
  const raw = process.env.BACKTEST_SEED_MINTS;
  if (raw === '') return [];
  if (raw) {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  return DEFAULT_SEED_MINTS;
}

const CONFIG = {
  LOOKBACK_DAYS: Number(process.env.BACKTEST_LOOKBACK_DAYS) || 3,
  TARGET_PER_GROUP: Number(process.env.BACKTEST_TARGET_PER_GROUP) || 40,
  MIN_RETAINED_PER_GROUP: Number(process.env.BACKTEST_MIN_RETAINED) || 20,
  /** Stage 2/4 gate: retained candidates with confirmed viral posts per outcome group. */
  MIN_RETAINED_NARRATIVE_PER_GROUP: Number(process.env.BACKTEST_MIN_RETAINED_NARRATIVE) || 20,
  SEED_MINTS: parseSeedMints(),
  NARRATIVE_MINTS: [],
  NON_NARRATIVE_MINTS: [],

  /** Birdeye OHLCV window after launch for ATH peak (hours). */
  OHLCV_HOURS_AFTER_LAUNCH: Number(process.env.BACKTEST_OHLCV_HOURS) || 72,
  /** ATH candle source: geckoterminal (free), birdeye, or none. */
  ATH_OHLCV_SOURCE: (process.env.BACKTEST_ATH_SOURCE || 'geckoterminal').toLowerCase(),

  /** graduated = pumpswap bonds via GeckoTerminal; legacy = DexScreener keyword search. */
  DISCOVERY_MODE: (process.env.BACKTEST_DISCOVERY || 'graduated').toLowerCase(),
  /** In graduated mode, optionally pull DexScreener keyword hits (includes non-migrated pumpfun). Default off. */
  LEGACY_SUPPLEMENT: process.env.BACKTEST_LEGACY_SUPPLEMENT === '1',
  MAX_DISCOVERY_CANDIDATES: Number(process.env.BACKTEST_MAX_CANDIDATES) || 500,
  MIN_GRADUATED_RESERVE_USD: Number(process.env.BACKTEST_MIN_GRADUATED_LIQ_USD) || 5_000,
  GECKO_MAX_PAGES: Number(process.env.BACKTEST_GECKO_MAX_PAGES) || 30,
  /** Max discovery rounds when looping for full sample (stage 1 / pipeline). */
  MAX_DISCOVERY_ROUNDS: Number(process.env.BACKTEST_MAX_DISCOVERY_ROUNDS) || 12,
  DISCOVERY_ROUND_SLEEP_MS: Number(process.env.BACKTEST_DISCOVERY_ROUND_SLEEP_MS) || 45_000,
  TICKER_DEDUP: process.env.BACKTEST_TICKER_DEDUP !== '0',

  WINNER_PEAK_MULTIPLE: Number(process.env.BACKTEST_WINNER_PEAK_MULTIPLE) || 5,
  WINNER_PEAK_LIQ_USD: Number(process.env.BACKTEST_WINNER_PEAK_LIQ_USD) || 50_000,
  WINNER_PEAK_MCAP_USD: Number(process.env.BACKTEST_WINNER_PEAK_MCAP_USD) || 50_000,
  LOSER_PEAK_MULTIPLE: Number(process.env.BACKTEST_LOSER_PEAK_MULTIPLE) || 1.5,
  LOSER_LIQ_DEAD_HOURS: Number(process.env.BACKTEST_LOSER_LIQ_DEAD_HOURS) || 24,
  LOSER_LIQ_FLOOR_USD: Number(process.env.BACKTEST_LOSER_LIQ_FLOOR_USD) || 500,

  POST_SEARCH_HOURS_BEFORE_LAUNCH: Number(process.env.BACKTEST_POST_SEARCH_HOURS) || 48,
  MATCH_CONFIDENCE_MIN: Number(process.env.BACKTEST_MATCH_CONFIDENCE_MIN) || 0.35,
  /** Minimum impression_count to count as a viral originating post (unless mint is in text). */
  MIN_VIRAL_VIEWS: Number(process.env.BACKTEST_MIN_VIRAL_VIEWS) || 100_000,

  FEATURE_WINDOW_MIN: Number(process.env.BACKTEST_FEATURE_WINDOW_MIN) || 30,

  MIN_INGEST_VIEWS: Number(process.env.MIN_INGEST_VIEWS) || 30_000,
  MEME_MIN_X: Number(process.env.MEME_MIN_X) || 0.7,
  MIN_DISPLAY_VIEWS: Number(process.env.MIN_DISPLAY_VIEWS) || 200_000,

  X_OFFICIAL_CREDIT_BUDGET: Number(process.env.X_OFFICIAL_CREDIT_BUDGET) || 10,
  X_OFFICIAL_COST_PER_READ: Number(process.env.X_OFFICIAL_COST_PER_READ) || 0.005,
  X_OFFICIAL_MAX_RESULTS: Number(process.env.X_OFFICIAL_MAX_RESULTS) || 15,
  TWEETS_PER_QUERY_ESTIMATE: Number(process.env.BACKTEST_TWEETS_PER_QUERY) || 15,

  CURRENT_THRESHOLDS: {
    MIN_INGEST_VIEWS: Number(process.env.MIN_INGEST_VIEWS) || 30_000,
    MEME_MIN_X: Number(process.env.MEME_MIN_X) || 0.7,
    MIN_DISPLAY_VIEWS: Number(process.env.MIN_DISPLAY_VIEWS) || 200_000,
  },
};

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith('--mint=')) flags.mint = arg.slice('--mint='.length).trim();
    else if (arg === '--once') flags.once = true;
    else if (arg === '--all') flags.all = true;
    else if (arg.startsWith('--run=')) flags.runId = arg.slice('--run='.length).trim();
    else if (arg === '--resume') flags.resume = true;
  }
  return flags;
}

module.exports = { CONFIG, parseArgs };
