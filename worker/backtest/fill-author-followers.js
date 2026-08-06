#!/usr/bin/env node
'use strict';

/**
 * Fill author_followers for syndication-enriched X rows in backtest-enriched.csv.
 *
 * author_followers is a CLEAN early signal — unlike views_now [contaminated],
 * follower count at lookup time is not meaningfully inflated by the coin's
 * later success and is safe to use in analysis.
 *
 * Run: npm run backtest:fill-followers
 */

const fs = require('fs');
const path = require('path');
const { loadEnvLocal } = require('../lib/env');
const { readCsv, writeCsv, BACKTEST_DIR } = require('./lib/blind-csv');
const { normalizeHandle, lookupFollowers } = require('./lib/follower-lookup');

const ENRICHED_PATH = path.join(BACKTEST_DIR, 'backtest-enriched.csv');

function readCommentLines(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const comments = [];
  for (const line of lines) {
    if (line.trim().startsWith('#')) comments.push(line.replace(/^#\s?/, ''));
    else if (line.trim()) break;
  }
  return comments;
}

async function main() {
  loadEnvLocal();
  const inputArg = process.argv.find(a => a.startsWith('--input='));
  const enrichedPath = inputArg
    ? path.resolve(inputArg.slice('--input='.length))
    : ENRICHED_PATH;
  if (!fs.existsSync(enrichedPath)) {
    throw new Error(`missing ${enrichedPath} — run enrich first`);
  }

  let getUserByUsername = null;
  let spendAtStart = { cost: 0, reads: 0 };
  if (process.env.X_OFFICIAL_BEARER_TOKEN) {
    const official = require('../lib/x-official-adapter');
    getUserByUsername = official.getUserByUsername;
    spendAtStart = official.spendSummary();
    console.log('[followers] X official fallback enabled (budget-guarded)');
  } else {
    console.log('[followers] X official fallback disabled — set X_OFFICIAL_BEARER_TOKEN to enable');
  }

  const commentLines = readCommentLines(enrichedPath);
  const { headers, rows } = readCsv(enrichedPath);

  const methodCol = 'author_followers_method';
  if (!headers.includes(methodCol)) headers.push(methodCol);

  const targetRows = rows.filter(
    row => row.enrich_method === 'syndication' && normalizeHandle(row.author_handle),
  );
  const handleToRows = new Map();
  for (const row of targetRows) {
    const key = normalizeHandle(row.author_handle).toLowerCase();
    if (!handleToRows.has(key)) handleToRows.set(key, []);
    handleToRows.get(key).push(row);
  }

  console.log(`[followers] ${targetRows.length} syndication rows · ${handleToRows.size} unique handles`);

  const cache = new Map();
  const stats = { x_profile: 0, nitter: 0, x_official: 0, failed: 0 };
  const failures = [];
  let i = 0;

  for (const handleKey of handleToRows.keys()) {
    i += 1;
    const display = handleToRows.get(handleKey)[0].author_handle;
    process.stdout.write(`[followers] ${i}/${handleToRows.size} ${display}…\r`);
    const result = await lookupFollowers(display, { getUserByUsername });
    cache.set(handleKey, result);
    if (stats[result.method] != null) stats[result.method] += 1;
    else stats.failed += 1;
    if (result.method === 'failed') {
      failures.push({ handle: display, error: result.error });
    }
  }

  for (const row of rows) {
    if (row.enrich_method !== 'syndication') continue;
    const key = normalizeHandle(row.author_handle).toLowerCase();
    const hit = cache.get(key);
    if (!hit) continue;
    row.author_followers = hit.followers ?? '';
    row[methodCol] = hit.method ?? '';
  }

  const { spendSummary } = require('../lib/x-official-adapter');
  const spendEnd = spendSummary();
  const runReads = spendEnd.reads - spendAtStart.reads;
  const runCost = spendEnd.cost - spendAtStart.cost;

  const outComments = [
    ...commentLines.filter(c => !c.startsWith('author_followers')),
    'author_followers is a CLEAN early signal — not inflated by post-launch coin success (safe for analysis).',
    'views_now / replies_now / reposts_now remain CONTAMINATED post-launch metrics.',
    `Follower fill ${new Date().toISOString()} · methods: ${JSON.stringify(stats)}`,
    `X official spend this run: $${runCost.toFixed(3)} (${runReads} reads)`,
  ];

  writeCsv(enrichedPath, { commentLines: outComments, headers, rows });

  console.log('\n=== FOLLOWER FILL COMPLETE ===');
  console.log(`Rows updated: ${targetRows.length} (${handleToRows.size} unique handles)`);
  console.log('Methods:', stats);
  console.log(`X official spend (this run): $${runCost.toFixed(3)} (${runReads} reads)`);
  console.log(`Output: ${enrichedPath}`);

  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  ${f.handle}: ${f.error}`);
    }
  }
}

main().catch(err => {
  console.error('[backtest:fill-followers]', err.message || err);
  process.exit(1);
});
