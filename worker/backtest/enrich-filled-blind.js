#!/usr/bin/env node
'use strict';

/**
 * Enrich hand-filled blind sheet with post metadata.
 *
 * CONTAMINATED METRICS WARNING:
 * views_now, replies_now and reposts_now reflect engagement AFTER coin launch —
 * they are inflated by the coin's own success and are NOT valid early viral signals.
 * They are included for reference only; do not use them as predictive features.
 *
 * Run: npm run backtest:enrich-filled
 * Input: filled-backtest-blind-sheet.csv (project root or Downloads)
 * Output: backtest/backtest-enriched.csv (never overwrites the hand-filled file)
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

function resolveInputPath() {
  const arg = process.argv.find(a => a.startsWith('--input='));
  if (arg) return path.resolve(arg.slice('--input='.length));
  const candidates = [
    path.join(process.cwd(), 'filled-backtest-blind-sheet.csv'),
    path.join(process.env.USERPROFILE || '', 'Downloads', 'filled-backtest-blind-sheet.csv'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    'filled-backtest-blind-sheet.csv not found — pass --input=/path/to/file.csv',
  );
}

function blankEnrich() {
  const row = {};
  for (const col of ENRICH_COLS) row[col] = '';
  return row;
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
    row['hours_post_to_launch'] = computeHoursPostToLaunch(coinCreatedAt, enrich.post_created_at);
  }
}

async function main() {
  loadEnvLocal();
  const inputPath = resolveInputPath();
  const outputPath = path.join(BACKTEST_DIR, 'backtest-enriched.csv');
  const blindPath = path.join(BACKTEST_DIR, 'backtest-blind.csv');

  console.log(`[enrich] input  ${inputPath}`);
  console.log(`[enrich] output ${outputPath}`);
  console.log('[enrich] views_now / replies_now / reposts_now are CONTAMINATED (post-launch inflation)');

  let getTweetById = null;
  let spendAtStart = { cost: 0, reads: 0 };
  if (process.env.X_OFFICIAL_BEARER_TOKEN) {
    const official = require('../lib/x-official-adapter');
    getTweetById = official.getTweetById;
    spendAtStart = official.spendSummary();
    console.log('[enrich] X official fallback enabled (budget-guarded)');
  } else {
    console.log('[enrich] X official fallback disabled — set X_OFFICIAL_BEARER_TOKEN to enable');
  }

  const { headers: filledHeaders, rows } = readCsv(inputPath);
  const blind = fs.existsSync(blindPath) ? readCsv(blindPath) : { rows: [] };
  const coinByRowId = new Map(blind.rows.map(r => [String(r.row_id), r.created_at || r.graduated_at || '']));
  const coinByMint = new Map(blind.rows.map(r => [String(r.mint), r.created_at || r.graduated_at || '']));

  const outHeaders = [...filledHeaders];
  for (const col of ENRICH_COLS) {
    if (!outHeaders.includes(col)) outHeaders.push(col);
  }

  const stats = {
    total: rows.length,
    withPostUrl: 0,
    enriched: 0,
    failed: 0,
    skipped: 0,
    byMethod: {},
  };
  const failures = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = { ...rows[i] };
    const postUrl = (row.post_url || '').trim();
    const coinCreatedAt = coinByRowId.get(String(row.row_id))
      || coinByMint.get(String(row.mint))
      || '';

    if (!postUrl) {
      applyEnrich(row, blankEnrich(), coinCreatedAt);
      rows[i] = row;
      continue;
    }

    stats.withPostUrl += 1;
    process.stdout.write(`[enrich] ${i + 1}/${rows.length} row ${row.row_id} ${detectPlatform(postUrl)}…\r`);

    const enrich = await enrichPostUrl(postUrl, { getTweetById });
    applyEnrich(row, { ...blankEnrich(), ...enrich }, coinCreatedAt);
    rows[i] = row;

    const method = enrich.enrich_method || 'unknown';
    stats.byMethod[method] = (stats.byMethod[method] || 0) + 1;

    if (method === 'failed') {
      stats.failed += 1;
      failures.push({ row_id: row.row_id, post_url: postUrl, error: enrich.enrich_error });
    } else if (method === 'skipped') {
      stats.skipped += 1;
      failures.push({ row_id: row.row_id, post_url: postUrl, error: enrich.enrich_error });
    } else {
      stats.enriched += 1;
    }
  }

  console.log(`\n[enrich] writing ${rows.length} rows`);

  const { spendSummary } = require('../lib/x-official-adapter');
  const spendEnd = spendSummary();
  const runReads = spendEnd.reads - spendAtStart.reads;
  const runCost = spendEnd.cost - spendAtStart.cost;

  writeCsv(outputPath, {
    commentLines: [
      'CONTAMINATED METRICS: views_now, replies_now, reposts_now are post-launch engagement — NOT early signals.',
      'They are inflated by the coin\'s success after launch; use for reference only.',
      `Enriched ${new Date().toISOString()} from ${path.basename(inputPath)}`,
      `X official spend this run: $${runCost.toFixed(3)} (${runReads} reads)`,
    ],
    headers: outHeaders,
    rows,
  });

  console.log('\n=== ENRICH COMPLETE ===');
  console.log(`Rows: ${stats.total} · with post_url: ${stats.withPostUrl}`);
  console.log(`Enriched: ${stats.enriched} · failed: ${stats.failed} · skipped: ${stats.skipped}`);
  console.log('Methods:', stats.byMethod);
  console.log(`X official spend (this run): $${runCost.toFixed(3)} (${runReads} reads)`);
  console.log(`X official spend (session): $${spendEnd.cost.toFixed(3)} / $${spendEnd.budget.toFixed(2)}`);
  console.log(`Output: ${outputPath}`);

  if (failures.length) {
    console.log('\nFailures / skips:');
    for (const f of failures) {
      console.log(`  row ${f.row_id}: ${f.error}`);
      console.log(`    ${f.post_url}`);
    }
  }
}

main().catch(err => {
  console.error('[backtest:enrich-filled]', err.message || err);
  process.exit(1);
});
