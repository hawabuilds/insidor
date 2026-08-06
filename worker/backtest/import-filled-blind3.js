#!/usr/bin/env node
'use strict';

/**
 * Import a hand-filled blind sheet CSV into backtest/filled-backtest3-blind-sheet.csv
 * with full column headers (adds empty match_confidence if missing).
 * Run: node worker/backtest/import-filled-blind3.js [path-to-filled.csv]
 */

const fs = require('fs');
const path = require('path');
const { readCsv, writeCsv, BACKTEST_DIR } = require('./lib/blind-csv');

const DEFAULT_SRC = path.join(
  process.env.USERPROFILE || '',
  'Downloads',
  'backtest3-blind-sheet - backtest3-blind-sheet.csv.csv',
);
const OUT = path.join(BACKTEST_DIR, 'filled-backtest3-blind-sheet.csv');

const HEADERS = [
  'row_id', 'ticker', 'name', 'description', 'created',
  'twitter', 'x_search', 'pumpfun', 'mint',
  'post_url', 'origin_platform',
  'one_word (Y/N)', 'has_character (Y/N)', 'works_as_photo (Y/N)',
  'funny_not_serious (Y/N)', 'others_copying (Y/N)', 'crypto_noticed (Y/N)',
  'ticker_in_replies (Y/N)', 'match_confidence', 'notes',
];

const FROM_ALIASES = {
  me: 'name',
};

function mintFromPumpfun(url) {
  const m = String(url || '').match(/pump\.fun\/([1-9A-HJ-NP-Za-km-z]{32,44})/);
  return m ? m[1] : '';
}

function mapRow(src) {
  const row = {};
  for (const h of HEADERS) row[h] = '';
  const keyMap = {
    row_id: 'row_id',
    ticker: 'ticker',
    name: 'name',
    me: 'name',
    description: 'description',
    created: 'created',
    twitter: 'twitter',
    x_search: 'x_search',
    pumpfun: 'pumpfun',
    mint: 'mint',
    post_url: 'post_url',
    origin_platform: 'origin_platform',
    'one_word (Y/N)': 'one_word (Y/N)',
    'has_character (Y/N)': 'has_character (Y/N)',
    'works_as_photo (Y/N)': 'works_as_photo (Y/N)',
    'funny_not_serious (Y/N)': 'funny_not_serious (Y/N)',
    'others_copying (Y/N)': 'others_copying (Y/N)',
    'crypto_noticed (Y/N)': 'crypto_noticed (Y/N)',
    'ticker_in_replies (Y/N)': 'ticker_in_replies (Y/N)',
    match_confidence: 'match_confidence',
    notes: 'notes',
  };
  for (const [k, v] of Object.entries(src)) {
    const canon = keyMap[k] || keyMap[FROM_ALIASES[k]];
    if (canon) row[canon] = v ?? '';
  }
  if (!row.mint) row.mint = mintFromPumpfun(row.pumpfun);
  return row;
}

function main() {
  const src = process.argv[2] || DEFAULT_SRC;
  if (!fs.existsSync(src)) {
    console.error(`Missing filled file: ${src}`);
    process.exit(1);
  }
  const { rows } = readCsv(src);
  const outRows = rows.map(mapRow);
  fs.mkdirSync(BACKTEST_DIR, { recursive: true });
  writeCsv(OUT, { commentLines: [], headers: HEADERS, rows: outRows });
  const viral = outRows.filter(r => String(r.post_url || '').trim()).length;
  console.log(`[import] ${outRows.length} rows → ${OUT}`);
  console.log(`[import] viral origins (post_url): ${viral}`);
}

main();
