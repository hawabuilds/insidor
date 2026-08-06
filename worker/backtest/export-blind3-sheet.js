#!/usr/bin/env node
'use strict';

/** Export Google Sheets–friendly view from backtest3-blind.csv. Run: npm run backtest3:blind-sheet */

const path = require('path');
const { readCsv, writeCsv, BACKTEST_DIR } = require('./lib/blind-csv');

const INPUT = path.join(BACKTEST_DIR, 'backtest3-blind.csv');
const OUTPUT = path.join(BACKTEST_DIR, 'backtest3-blind-sheet.csv');

const HEADERS = [
  'row_id', 'ticker', 'name', 'description', 'created',
  'twitter', 'x_search', 'pumpfun', 'mint',
  'post_url', 'origin_platform',
  'one_word (Y/N)', 'has_character (Y/N)', 'works_as_photo (Y/N)',
  'funny_not_serious (Y/N)', 'others_copying (Y/N)', 'crypto_noticed (Y/N)',
  'ticker_in_replies (Y/N)', 'match_confidence', 'notes',
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

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
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
    else if (h === 'description') row[h] = sheetCell(src.description, 160);
    else if (h === 'created') row[h] = shortDate(src.coin_created_at);
    else if (h === 'mint') row[h] = sheetCell(mintFromPumpfun(src.pumpfun_url));
    else if (h === 'notes') row[h] = sheetCell(src.notes, 300);
    else {
      const key = COL_MAP[h] || h;
      row[h] = sheetCell(src[key]);
    }
  }
  return row;
}

function main() {
  const { rows } = readCsv(INPUT);
  writeCsv(OUTPUT, { commentLines: [], headers: HEADERS, rows: rows.map(toSheetRow) });
  console.log(`Wrote ${rows.length} rows → ${OUTPUT}`);
  console.log('\nImport: backtest3-blind-sheet.csv · Comma · Convert numbers: No · Freeze row 1');
}

main();
