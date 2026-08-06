#!/usr/bin/env node
'use strict';

/**
 * Build blind hand-labeling sample — graduated pump.fun coins, no X API.
 * Run: npm run backtest:blind-sample
 * Resume: npm run backtest:blind-sample -- --resume  (or auto if checkpoint exists)
 * Fresh:   npm run backtest:blind-sample -- --fresh
 */

const fs = require('fs');
const path = require('path');
const { loadEnvLocal } = require('../lib/env');
const { discoverGraduatedInWindow } = require('./lib/blind-discovery');
const { enrichBlindRow } = require('./lib/blind-enrich');
const { randomSample } = require('./lib/seeded-random');
const { writeCsv, BACKTEST_DIR } = require('./lib/blind-csv');

const SAMPLE_SIZE = Number(process.env.BACKTEST_BLIND_SAMPLE_SIZE) || 150;
const SEED = Number(process.env.BACKTEST_BLIND_SEED) || 42;
const LOOKBACK_CANDIDATES = (process.env.BACKTEST_BLIND_LOOKBACK_DAYS || '2,3,4')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(n => n > 0);

const CHECKPOINT_PATH = path.join(BACKTEST_DIR, 'backtest-blind-checkpoint.json');

const BLIND_HEADERS = [
  'row_id', 'mint', 'ticker', 'name', 'description', 'image_url', 'twitter_url', 'website_url',
  'created_at', 'graduated_at', 'pumpfun_url',
  'post_url', 'post_views', 'nameable_one_word', 'named_subject', 'screenshot_able',
  'absurd_not_earnest', 'replication_seen', 'ct_pickup', 'was_first_coin',
  'hours_post_to_launch', 'no_viral_origin', 'notes',
];

const ANSWER_HEADERS = [
  'row_id', 'ath_price', 'ath_mcap', 'peak_multiple', 'current_mcap', 'liquidity_now',
];

const MANUAL_COLS = [
  'post_url', 'post_views', 'nameable_one_word', 'named_subject', 'screenshot_able',
  'absurd_not_earnest', 'replication_seen', 'ct_pickup', 'was_first_coin',
  'hours_post_to_launch', 'no_viral_origin', 'notes',
];

const argv = process.argv.slice(2);
const FORCE_FRESH = argv.includes('--fresh');
const FORCE_RESUME = argv.includes('--resume');

function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveCheckpoint(state) {
  fs.mkdirSync(BACKTEST_DIR, { recursive: true });
  fs.writeFileSync(CHECKPOINT_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function clearCheckpoint() {
  if (fs.existsSync(CHECKPOINT_PATH)) fs.unlinkSync(CHECKPOINT_PATH);
}

function checkpointMatches(cp) {
  return cp
    && cp.version === 1
    && cp.sample_size === SAMPLE_SIZE
    && cp.seed === SEED
    && Array.isArray(cp.sampled)
    && Array.isArray(cp.blind_rows)
    && Array.isArray(cp.answer_rows);
}

async function resolveWindow() {
  for (const days of LOOKBACK_CANDIDATES) {
    const cutoffMs = Date.now() - days * 86_400_000;
    const { rows, source } = await discoverGraduatedInWindow(cutoffMs, days);
    console.log(`[blind] ${days}d window → ${rows.length} graduations (source: ${source})`);
    if (rows.length >= SAMPLE_SIZE || days === LOOKBACK_CANDIDATES[LOOKBACK_CANDIDATES.length - 1]) {
      return { days, rows, source, cutoffMs };
    }
    console.log(`[blind] fewer than ${SAMPLE_SIZE} — widening lookback`);
  }
  return { days: LOOKBACK_CANDIDATES[0], rows: [], source: 'none', cutoffMs: Date.now() - 2 * 86_400_000 };
}

function rowFromEnriched(enriched, row_id) {
  const blind = {
    row_id,
    mint: enriched.mint,
    ticker: enriched.ticker,
    name: enriched.name,
    description: enriched.description,
    image_url: enriched.image_url,
    twitter_url: enriched.twitter_url,
    website_url: enriched.website_url,
    created_at: enriched.created_at,
    graduated_at: enriched.graduated_at,
    pumpfun_url: enriched.pumpfun_url,
  };
  for (const col of MANUAL_COLS) blind[col] = '';
  const answer = {
    row_id,
    ath_price: enriched.ath_price ?? '',
    ath_mcap: enriched.ath_mcap ?? '',
    peak_multiple: enriched.peak_multiple ?? '',
    current_mcap: enriched.current_mcap ?? '',
    liquidity_now: enriched.liquidity_now ?? '',
  };
  return { blind, answer };
}

function writeOutputs({ meta, blindRows, answerRows, days, rows, source }) {
  const blindPath = path.join(BACKTEST_DIR, 'backtest-blind.csv');
  const answerPath = path.join(BACKTEST_DIR, 'backtest-answers.csv');
  const metaPath = path.join(BACKTEST_DIR, 'backtest-blind-meta.json');

  writeCsv(blindPath, {
    commentLines: [
      'WARNING: Do NOT open backtest-answers.csv until you have finished labeling backtest-blind.csv.',
      'This file contains NO outcome data — hand-label viral origin only.',
      `Built ${meta.built_at} · ${meta.graduations_in_window} graduations in ${days}d · sample ${meta.sample_size} · seed ${SEED} · source ${source}`,
    ],
    headers: BLIND_HEADERS,
    rows: blindRows,
  });
  writeCsv(answerPath, {
    commentLines: [
      'ANSWER KEY — do not open until blind labeling is complete.',
      'Join to backtest-blind.csv on row_id · npm run backtest:reveal',
    ],
    headers: ANSWER_HEADERS,
    rows: answerRows,
  });
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  console.log('\n=== BLIND SAMPLE BUILT ===');
  console.log(`Graduations in window (${days}d): ${rows.length}`);
  console.log(`Sampled: ${blindRows.length} (seed ${SEED})`);
  console.log(`Blind file:  ${blindPath}`);
  console.log(`Answer key:  ${answerPath}  ← do not open yet`);
  console.log(`Meta:        ${metaPath}`);
  if (rows.length < SAMPLE_SIZE) {
    console.log(`\n⚠ Only ${rows.length} graduations available (target ${SAMPLE_SIZE}). Widened to ${days}d.`);
  }
}

async function main() {
  loadEnvLocal();
  console.log(
    `[blind] building sample · target ${SAMPLE_SIZE} · seed ${SEED} · lookback ${LOOKBACK_CANDIDATES.join('/')}d · no X API`,
  );

  let cp = !FORCE_FRESH ? loadCheckpoint() : null;
  let sampled;
  let blindRows;
  let answerRows;
  let days;
  let rows;
  let source;
  let meta;

  if (cp && checkpointMatches(cp) && (FORCE_RESUME || cp.blind_rows.length > 0)) {
    ({ sampled, blind_rows: blindRows, answer_rows: answerRows, meta } = cp);
    days = meta.lookback_days;
    rows = { length: meta.graduations_in_window };
    source = meta.discovery_source;
    console.log(`[blind] resuming checkpoint · ${blindRows.length}/${sampled.length} already enriched`);
  } else {
    if (cp && !FORCE_FRESH) console.log('[blind] ignoring stale checkpoint — starting fresh');
    clearCheckpoint();

    const window = await resolveWindow();
    ({ days, rows, source } = window);
    if (!rows.length) {
      console.error('\n⛔ No graduations found. Try PUMP_FUN_BEARER_TOKEN or run worker/backtest/dune-graduations.sql on Dune.');
      process.exit(1);
    }

    sampled = randomSample(rows, SAMPLE_SIZE, SEED);
    console.log(`[blind] random sample ${sampled.length} / ${rows.length} (seed ${SEED})`);
    blindRows = [];
    answerRows = [];
    meta = {
      started_at: new Date().toISOString(),
      lookback_days: days,
      graduations_in_window: rows.length,
      sample_size: sampled.length,
      random_seed: SEED,
      discovery_source: source,
    };
    saveCheckpoint({
      version: 1,
      sample_size: SAMPLE_SIZE,
      seed: SEED,
      meta,
      sampled,
      blind_rows: blindRows,
      answer_rows: answerRows,
    });
  }

  const startIdx = blindRows.length;
  for (let i = startIdx; i < sampled.length; i += 1) {
    const base = sampled[i];
    const rowNum = i + 1;
    process.stdout.write(`[blind] enrich ${rowNum}/${sampled.length} ${base.mint.slice(0, 8)}…\r`);
    let enriched;
    try {
      enriched = await enrichBlindRow(base);
    } catch (err) {
      console.warn(`\n[blind] enrich failed row ${rowNum} ${base.mint.slice(0, 8)}: ${err.message || err}`);
      enriched = {
        mint: base.mint,
        ticker: base.ticker || '',
        name: base.name || '',
        description: base.description || '',
        image_url: base.image_url || '',
        twitter_url: base.twitter_url || '',
        website_url: base.website_url || '',
        created_at: base.created_at || '',
        graduated_at: base.graduated_at || '',
        pumpfun_url: `https://pump.fun/${base.mint}`,
        ath_price: null,
        ath_mcap: null,
        peak_multiple: null,
        current_mcap: null,
        liquidity_now: null,
      };
    }
    const row_id = String(rowNum);
    const { blind, answer } = rowFromEnriched(enriched, row_id);
    blindRows.push(blind);
    answerRows.push(answer);
    saveCheckpoint({
      version: 1,
      sample_size: SAMPLE_SIZE,
      seed: SEED,
      meta,
      sampled,
      blind_rows: blindRows,
      answer_rows: answerRows,
    });
  }
  console.log(`\n[blind] enrichment done`);

  meta.built_at = new Date().toISOString();
  meta.sample_size = blindRows.length;

  writeOutputs({ meta, blindRows, answerRows, days, rows, source });
  clearCheckpoint();
}

main().catch(err => {
  console.error('[backtest:blind-sample]', err.message || err);
  process.exit(1);
});
