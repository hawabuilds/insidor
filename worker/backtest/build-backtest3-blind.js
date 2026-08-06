#!/usr/bin/env node
'use strict';

/**
 * Build backtest3 extension (60d, excludes filled backtest2 mints).
 * Run: npm run backtest3:build
 * Resume: npm run backtest3:build -- --resume
 */

const fs = require('fs');
const path = require('path');
const { loadEnvLocal } = require('../lib/env');
const { enrichBlindMetadata } = require('./lib/blind-enrich');
const { randomSample, seededShuffle } = require('./lib/seeded-random');
const { readCsv, writeCsv, BACKTEST_DIR } = require('./lib/blind-csv');

loadEnvLocal();

const SEED = Number(process.env.BACKTEST2_SEED) || 42;
const WINDOW_DAYS = 60;
const WINNER_PEAK = 10;
const WINNER_ATH = 250_000;
const MIN_TRADES_NEAR_PEAK = 3;
const LOSER_PEAK = 1.5;

const FILLED_BT2 = path.join(BACKTEST_DIR, 'filled-backtest2-blind-sheet.csv');
const PEAK_CHECKPOINT = path.join(BACKTEST_DIR, 'backtest3-peak-count-checkpoint.json');
const BUILD_CHECKPOINT = path.join(BACKTEST_DIR, 'backtest3-blind-checkpoint.json');
const BLIND_PATH = path.join(BACKTEST_DIR, 'backtest3-blind.csv');
const ANSWER_PATH = path.join(BACKTEST_DIR, 'backtest3-answers.csv');
const META_PATH = path.join(BACKTEST_DIR, 'backtest3-blind-meta.json');

const BLIND_HEADERS = [
  'row_id', 'ticker', 'name', 'description', 'coin_created_at',
  'metadata_twitter', 'x_search_url', 'pumpfun_url',
  'origin_platform', 'post_url', 'one_word_name', 'has_character',
  'works_as_photo', 'funny_not_serious', 'others_copying_it',
  'crypto_noticed', 'ticker_in_replies', 'match_confidence', 'notes',
];

const ANSWER_HEADERS = ['row_id', 'peak_multiple', 'ath_mcap', 'liquidity_now', 'group'];

const MANUAL_COLS = [
  'origin_platform', 'post_url', 'one_word_name', 'has_character',
  'works_as_photo', 'funny_not_serious', 'others_copying_it',
  'crypto_noticed', 'ticker_in_replies', 'match_confidence', 'notes',
];

const FORCE_FRESH = process.argv.includes('--fresh');
const FORCE_RESUME = process.argv.includes('--resume');

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function inWindow(row) {
  return row.graduatedMs >= Date.now() - WINDOW_DAYS * 86_400_000;
}

function isStrictWinner(r) {
  return r.peak_multiple != null
    && r.peak_multiple >= WINNER_PEAK
    && r.ath_mcap != null
    && r.ath_mcap >= WINNER_ATH
    && r.trades_near_peak != null
    && r.trades_near_peak >= MIN_TRADES_NEAR_PEAK;
}

function isLoser(r) {
  return r.peak_multiple != null && r.peak_multiple < LOSER_PEAK;
}

function loadExcludedMints() {
  const { rows } = readCsv(FILLED_BT2);
  const mints = new Set();
  for (const row of rows) {
    let mint = (row.mint || '').trim();
    if (!mint) {
      const m = String(row.pumpfun || row.pumpfun_url || '').match(/pump\.fun\/([1-9A-HJ-NP-Za-km-z]{32,44})/);
      mint = m ? m[1] : '';
    }
    if (mint) mints.add(mint);
  }
  return mints;
}

function selectCohort(rows, excludeMints) {
  const win = rows.filter(inWindow).filter(r => !excludeMints.has(r.mint));
  const winners = win.filter(isStrictWinner);
  const loserPool = win.filter(isLoser);
  const losers = randomSample(loserPool, winners.length, SEED);
  if (losers.length < winners.length) {
    throw new Error(`Loser pool too small: ${losers.length} vs ${winners.length} winners`);
  }
  return {
    winners,
    losers,
    tagged: [
      ...winners.map(r => ({ ...r, group: 'winner' })),
      ...losers.map(r => ({ ...r, group: 'loser' })),
    ],
  };
}

function saveBuildCheckpoint(state) {
  fs.mkdirSync(BACKTEST_DIR, { recursive: true });
  fs.writeFileSync(BUILD_CHECKPOINT, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function blindRowFromMeta(row_id, meta) {
  const blind = {
    row_id,
    ticker: meta.ticker,
    name: meta.name,
    description: meta.description,
    coin_created_at: meta.coin_created_at,
    metadata_twitter: meta.metadata_twitter,
    x_search_url: meta.x_search_url,
    pumpfun_url: meta.pumpfun_url,
  };
  for (const col of MANUAL_COLS) blind[col] = '';
  return blind;
}

async function main() {
  if (!fs.existsSync(PEAK_CHECKPOINT)) {
    throw new Error(`Missing ${PEAK_CHECKPOINT} — run npm run backtest3:preview first`);
  }
  if (!fs.existsSync(FILLED_BT2)) {
    throw new Error(`Missing ${FILLED_BT2}`);
  }

  const excludeMints = loadExcludedMints();
  const peakRows = loadJson(PEAK_CHECKPOINT).rows;
  const { winners, losers, tagged } = selectCohort(peakRows, excludeMints);
  const shuffled = seededShuffle(tagged, SEED);

  console.log(`[backtest3:build] ${winners.length} winners + ${losers.length} losers = ${shuffled.length} · excludes ${excludeMints.size} backtest2 mints · seed ${SEED}`);

  let cp = !FORCE_FRESH && fs.existsSync(BUILD_CHECKPOINT) ? loadJson(BUILD_CHECKPOINT) : null;
  if (cp && cp.version === 3 && cp.seed === SEED && cp.total === shuffled.length && (FORCE_RESUME || cp.blind_rows?.length)) {
    console.log(`[backtest3:build] resume · ${cp.blind_rows.length}/${shuffled.length}`);
  } else {
    cp = {
      version: 3,
      seed: SEED,
      total: shuffled.length,
      winner_count: winners.length,
      loser_count: losers.length,
      excluded_mints: excludeMints.size,
      blind_rows: [],
      answer_rows: [],
      meta: { started_at: new Date().toISOString() },
    };
    saveBuildCheckpoint(cp);
  }

  const startIdx = cp.blind_rows.length;
  for (let i = startIdx; i < shuffled.length; i += 1) {
    const peak = shuffled[i];
    const row_id = String(i + 1);
    process.stdout.write(`[backtest3:build] enrich ${i + 1}/${shuffled.length} ${peak.mint.slice(0, 8)}…\r`);
    let meta;
    try {
      meta = await enrichBlindMetadata(peak);
    } catch (err) {
      console.warn(`\n[backtest3:build] enrich failed ${peak.mint.slice(0, 8)}: ${err.message}`);
      meta = {
        mint: peak.mint,
        ticker: peak.ticker || '',
        name: peak.name || '',
        description: '',
        coin_created_at: peak.created_at || peak.graduated_at || '',
        metadata_twitter: '',
        x_search_url: peak.ticker
          ? `https://x.com/search?q=${encodeURIComponent(peak.ticker)}&src=typed_query&f=top`
          : '',
        pumpfun_url: `https://pump.fun/${peak.mint}`,
        liquidity_now: null,
      };
    }
    cp.blind_rows.push(blindRowFromMeta(row_id, meta));
    cp.answer_rows.push({
      row_id,
      peak_multiple: peak.peak_multiple ?? '',
      ath_mcap: peak.ath_mcap ?? '',
      liquidity_now: meta.liquidity_now ?? '',
      group: peak.group,
    });
    if ((i + 1) % 25 === 0 || i === shuffled.length - 1) saveBuildCheckpoint(cp);
  }
  console.log('\n[backtest3:build] enrichment done');

  const builtAt = new Date().toISOString();
  writeCsv(BLIND_PATH, {
    commentLines: [
      'WARNING: Do NOT open backtest3-answers.csv until you have finished labeling backtest3-blind.csv.',
      'This file contains NO outcome data — hand-label viral origin only.',
      `Built ${builtAt} · ${shuffled.length} NEW rows · ${winners.length} winners + ${losers.length} losers · 60d window · excludes backtest2`,
    ],
    headers: BLIND_HEADERS,
    rows: cp.blind_rows,
  });

  writeCsv(ANSWER_PATH, {
    commentLines: [
      'ANSWER KEY — do not open until blind labeling is complete.',
      'Join to backtest3-blind.csv on row_id.',
    ],
    headers: ANSWER_HEADERS,
    rows: cp.answer_rows,
  });

  fs.writeFileSync(META_PATH, `${JSON.stringify({
    ...cp.meta,
    built_at: builtAt,
    window_days: WINDOW_DAYS,
    seed: SEED,
    winner_count: winners.length,
    loser_count: losers.length,
    excluded_backtest2_mints: excludeMints.size,
    total_rows: shuffled.length,
  }, null, 2)}\n`, 'utf8');

  if (fs.existsSync(BUILD_CHECKPOINT)) fs.unlinkSync(BUILD_CHECKPOINT);

  console.log('\n=== BACKTEST3 BUILT ===');
  console.log(`Blind:  ${BLIND_PATH}`);
  console.log(`Answers: ${ANSWER_PATH}  ← do not open yet`);
  console.log(`Run: npm run backtest3:blind-sheet`);
}

main().catch(err => {
  console.error('[backtest3:build]', err.message || err);
  process.exit(1);
});
