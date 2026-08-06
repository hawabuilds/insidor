#!/usr/bin/env node
'use strict';

/**
 * Export a Google Sheets–friendly labeling view from backtest2-blind.csv.
 * Run: npm run backtest2:blind-sheet
 */

const path = require('path');
const { readCsv, writeCsv, BACKTEST_DIR } = require('./lib/blind-csv');

const INPUT = path.join(BACKTEST_DIR, 'backtest2-blind.csv');
const OUTPUT = path.join(BACKTEST_DIR, 'backtest2-blind-sheet.csv');

const HEADERS = [
  'row_id',
  'ticker',
  'name',
  'description',
  'created',
  'twitter',
  'x_search',
  'pumpfun',
  'origin_platform',
  'post_url',
  'one_word (Y/N)',
  'has_character (Y/N)',
  'works_as_photo (Y/N)',
  'funny_not_serious (Y/N)',
  'others_copying (Y/N)',
  'crypto_noticed (Y/N)',
  'ticker_in_replies (Y/N)',
  'match_confidence',
  'notes',
  'mint',
];

const COL_MAP = {
  created: 'coin_created_at',
  twitter: 'metadata_twitter',
  x_search: 'x_search_url',
  pumpfun: 'pumpfun_url',
  'one_word (Y/N)': 'one_word_name',
  'has_character (Y/N)': 'has_character',
  'works_as_photo (Y/N)': 'works_as_photo',
  'funny_not_serious (Y/N)': 'funny_not_serious',
  'others_copying (Y/N)': 'others_copying_it',
  'crypto_noticed (Y/N)': 'crypto_noticed',
  'ticker_in_replies (Y/N)': 'ticker_in_replies',
};

function sheetCell(val, maxLen = null) {
  const s = String(val || '')
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  if (maxLen && s.length > maxLen) return `${s.slice(0, maxLen - 1)}…`;
  return s;
}

function flattenText(val, maxLen = 160) {
  return sheetCell(val, maxLen);
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  const hr = d.getHours();
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mo}/${day} ${hr}:${min}`;
}

function mintFromPumpfun(url) {
  const m = String(url || '').match(/pump\.fun\/([1-9A-HJ-NP-Za-km-z]{32,44})/);
  return m ? m[1] : '';
}

function toSheetRow(src) {
  const row = {};
  for (const h of HEADERS) {
    if (h === 'row_id') row[h] = sheetCell(src.row_id);
    else if (h === 'ticker') row[h] = sheetCell(src.ticker);
    else if (h === 'name') row[h] = sheetCell(src.name);
    else if (h === 'description') row[h] = flattenText(src.description);
    else if (h === 'created') row[h] = shortDate(src.coin_created_at);
    else if (h === 'notes') row[h] = sheetCell(src.notes, 300);
    else if (h === 'match_confidence') row[h] = sheetCell(src.match_confidence);
    else if (h === 'origin_platform') row[h] = sheetCell(src.origin_platform);
    else if (h === 'post_url') row[h] = sheetCell(src.post_url);
    else if (h === 'mint') row[h] = sheetCell(mintFromPumpfun(src.pumpfun_url));
    else {
      const key = COL_MAP[h] || h;
      row[h] = sheetCell(src[key]);
    }
  }
  return row;
}

function main() {
  const { rows } = readCsv(INPUT);
  const sheetRows = rows.map(toSheetRow);
  writeCsv(OUTPUT, {
    commentLines: [],
    headers: HEADERS,
    rows: sheetRows,
  });
  console.log(`Wrote ${sheetRows.length} rows → ${OUTPUT}`);
  console.log('');
  console.log('Google Sheets import:');
  console.log('  1. File → Import → Upload → backtest2-blind-sheet.csv');
  console.log('  2. Separator: Comma · Convert text to numbers: No');
  console.log('  3. Hide column T (mint) after import if you want to stay blind to grouping');
  console.log('  4. View → Freeze → 1 row');
  console.log('  5. Y/N columns: Y, N, or blank');
}

main();
