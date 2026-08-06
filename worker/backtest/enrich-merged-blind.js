#!/usr/bin/env node
'use strict';

/**
 * Join merged blind + answers, then enrich rows with post_url.
 * Run: npm run backtest:enrich-merged
 *
 * Input:  backtest-merged-blind.csv + backtest-merged-answers.csv
 * Output: backtest-merged-enriched.csv (never overwrites filled sheets)
 */

const fs = require('fs');
const path = require('path');
const { loadEnvLocal } = require('../lib/env');
const { readCsv, writeCsv, BACKTEST_DIR } = require('./lib/blind-csv');
const {
  detectPlatform,
  enrichXPost,
  enrichTikTok,
  enrichYouTube,
  enrichInstagram,
  enrichReddit,
  computeHoursPostToLaunch,
} = require('./lib/post-enrich');

loadEnvLocal();

const MERGED_BLIND = path.join(BACKTEST_DIR, 'backtest-merged-blind.csv');
const MERGED_ANSWERS = path.join(BACKTEST_DIR, 'backtest-merged-answers.csv');
const OUT_PATH = path.join(BACKTEST_DIR, 'backtest-merged-enriched.csv');
const ISO_SOURCES = [
  path.join(BACKTEST_DIR, 'backtest2-blind.csv'),
  path.join(BACKTEST_DIR, 'backtest3-blind.csv'),
];

const ENRICH_COLS = [
  'author_handle',
  'author_followers',
  'post_created_at',
  'media_type',
  'views_now [contaminated]',
  'replies_now [contaminated]',
  'reposts_now [contaminated]',
  'post_text',
  'hours_post_to_launch',
  'enrich_method',
  'enrich_error',
];

const ENRICH_KEY_MAP = {
  'views_now [contaminated]': 'views_now',
  'replies_now [contaminated]': 'replies_now',
  'reposts_now [contaminated]': 'reposts_now',
};

const ANSWER_COLS = ['peak_multiple', 'ath_mcap', 'liquidity_now', 'group'];

function blankEnrich() {
  const row = {};
  for (const col of ENRICH_COLS) row[col] = '';
  return row;
}

function loadIsoByMint() {
  const map = new Map();
  for (const p of ISO_SOURCES) {
    if (!fs.existsSync(p)) continue;
    const { rows } = readCsv(p);
    for (const r of rows) {
      const mint = r.mint || mintFromPumpfun(r.pumpfun_url);
      const iso = r.coin_created_at || r.created_at;
      if (mint && iso) map.set(mint, iso);
    }
  }
  return map;
}

function mintFromPumpfun(url) {
  const m = String(url || '').match(/pump\.fun\/([1-9A-HJ-NP-Za-km-z]{32,44})/);
  return m ? m[1] : '';
}

function parseCoinCreatedAt(val, mint, isoByMint) {
  if (mint && isoByMint.has(mint)) return isoByMint.get(mint);
  const ms = Date.parse(val);
  if (Number.isFinite(ms)) return new Date(ms).toISOString();
  const m = String(val || '').trim().match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (m) {
    return new Date(2026, Number(m[1]) - 1, Number(m[2]), Number(m[3]), Number(m[4])).toISOString();
  }
  return val || '';
}

async function enrichPostUrl(postUrl, { getTweetById }) {
  const platform = detectPlatform(postUrl);
  if (platform === 'x') return enrichXPost(postUrl, { getTweetById });
  if (platform === 'tiktok') return enrichTikTok(postUrl);
  if (platform === 'youtube') return enrichYouTube(postUrl);
  if (platform === 'instagram') return enrichInstagram(postUrl);
  if (platform === 'reddit') return enrichReddit(postUrl);
  if (platform === 'x_other') {
    return { enrich_method: 'skipped', enrich_error: 'X URL is not a /status/ link' };
  }
  return { enrich_method: 'skipped', enrich_error: `unsupported platform (${platform})` };
}

function applyEnrich(row, enrich, coinCreatedAt) {
  for (const col of ENRICH_COLS) {
    const key = ENRICH_KEY_MAP[col] || col;
    row[col] = enrich[key] ?? '';
  }
  if (enrich.enrich_method && enrich.enrich_method !== 'failed') {
    row.hours_post_to_launch = computeHoursPostToLaunch(coinCreatedAt, enrich.post_created_at);
  }
}

function joinMerged() {
  const { headers: blindHeaders, rows: blindRows } = readCsv(MERGED_BLIND);
  const { rows: answerRows } = readCsv(MERGED_ANSWERS);
  const answerByKey = new Map(
    answerRows.map(r => [`${r.row_id}:${r.source_wave || ''}`, r]),
  );
  const joined = blindRows.map(r => {
    const key = `${r.row_id}:${r.source_wave || ''}`;
    const alt = answerByKey.get(`${r.row_id}:`) || answerByKey.get(String(r.row_id));
    const ans = answerByKey.get(key) || alt || {};
    const out = { ...r };
    for (const col of ANSWER_COLS) out[col] = ans[col] ?? '';
    return out;
  });
  return { blindHeaders, joined };
}

async function main() {
  if (!fs.existsSync(MERGED_BLIND) || !fs.existsSync(MERGED_ANSWERS)) {
    throw new Error('Run npm run backtest:merge first');
  }

  const isoByMint = loadIsoByMint();
  const { blindHeaders, joined: rows } = joinMerged();

  let getTweetById = null;
  let spendAtStart = { cost: 0, reads: 0 };
  if (process.env.X_OFFICIAL_BEARER_TOKEN) {
    const official = require('../lib/x-official-adapter');
    getTweetById = official.getTweetById;
    spendAtStart = official.spendSummary();
    console.log('[enrich-merged] X official fallback enabled');
  }

  const outHeaders = [...blindHeaders];
  for (const col of [...ANSWER_COLS, ...ENRICH_COLS]) {
    if (!outHeaders.includes(col)) outHeaders.push(col);
  }

  const stats = { total: rows.length, withPostUrl: 0, enriched: 0, failed: 0, skipped: 0, byMethod: {} };

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const postUrl = (row.post_url || '').trim();
    const coinCreatedAt = parseCoinCreatedAt(row.coin_created_at, row.mint, isoByMint);

    if (!postUrl) {
      applyEnrich(row, blankEnrich(), coinCreatedAt);
      continue;
    }

    stats.withPostUrl += 1;
    process.stdout.write(`[enrich-merged] ${i + 1}/${rows.length} row ${row.row_id} ${detectPlatform(postUrl)}…\r`);

    const enrich = await enrichPostUrl(postUrl, { getTweetById });
    applyEnrich(row, { ...blankEnrich(), ...enrich }, coinCreatedAt);

    const method = enrich.enrich_method || 'unknown';
    stats.byMethod[method] = (stats.byMethod[method] || 0) + 1;
    if (method === 'failed') stats.failed += 1;
    else if (method === 'skipped') stats.skipped += 1;
    else stats.enriched += 1;
  }

  const { spendSummary } = require('../lib/x-official-adapter');
  const spendEnd = spendSummary();
  const runCost = spendEnd.cost - spendAtStart.cost;
  const runReads = spendEnd.reads - spendAtStart.reads;

  writeCsv(OUT_PATH, {
    commentLines: [
      'Merged backtest2+3 · labels + answers + post enrichment.',
      'CONTAMINATED: views_now, replies_now, reposts_now are post-launch — not early signals.',
      'author_followers is clean (run npm run backtest:fill-followers-merged after).',
      `Enriched ${new Date().toISOString()} · X spend this run: $${runCost.toFixed(3)} (${runReads} reads)`,
    ],
    headers: outHeaders,
    rows,
  });

  console.log(`\n[enrich-merged] ${rows.length} rows · post_url: ${stats.withPostUrl} · enriched: ${stats.enriched}`);
  console.log(`[enrich-merged] methods:`, stats.byMethod);
  console.log(`[enrich-merged] → ${OUT_PATH}`);
  console.log('[enrich-merged] next: npm run backtest:fill-followers-merged');
}

main().catch(err => {
  console.error('[enrich-merged]', err.message || err);
  process.exit(1);
});
