#!/usr/bin/env node
'use strict';

/**
 * Export a Google Sheets–friendly labeling view from backtest-blind.csv.
 * Run: npm run backtest:blind-sheet
 */

const path = require('path');
const { readCsv, writeCsv, BACKTEST_DIR } = require('./lib/blind-csv');

const INPUT = path.join(BACKTEST_DIR, 'backtest-blind.csv');
const OUTPUT = path.join(BACKTEST_DIR, 'backtest-blind-sheet.csv');

const HEADERS = [
  'row_id',
  'ticker',
  'name',
  'description',
  'twitter',
  'pumpfun',
  'image',
  'graduated',
  'post_url',
  'post_views',
  'nameable (Y/N)',
  'named_subject (Y/N)',
  'screenshot (Y/N)',
  'absurd (Y/N)',
  'replication (Y/N)',
  'ct_pickup (Y/N)',
  'first_coin (Y/N)',
  'hours_post_to_launch',
  'no_viral (Y/N)',
  'notes',
  'mint',
];

const COL_MAP = {
  'nameable (Y/N)': 'nameable_one_word',
  'named_subject (Y/N)': 'named_subject',
  'screenshot (Y/N)': 'screenshot_able',
  'absurd (Y/N)': 'absurd_not_earnest',
  'replication (Y/N)': 'replication_seen',
  'ct_pickup (Y/N)': 'ct_pickup',
  'first_coin (Y/N)': 'was_first_coin',
  'no_viral (Y/N)': 'no_viral_origin',
  twitter: 'twitter_url',
  pumpfun: 'pumpfun_url',
  image: 'image_url',
  graduated: 'graduated_at',
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

function toSheetRow(src) {
  const row = {};
  for (const h of HEADERS) {
    if (h === 'row_id') row[h] = sheetCell(src.row_id);
    else if (h === 'ticker') row[h] = sheetCell(src.ticker);
    else if (h === 'name') row[h] = sheetCell(src.name);
    else if (h === 'description') row[h] = flattenText(src.description);
    else if (h === 'graduated') row[h] = shortDate(src.graduated_at);
    else if (h === 'notes') row[h] = sheetCell(src.notes, 300);
    else if (h === 'mint') row[h] = sheetCell(src.mint);
    else if (h === 'post_url') row[h] = sheetCell(src.post_url);
    else if (h === 'post_views') row[h] = sheetCell(src.post_views);
    else if (h === 'hours_post_to_launch') row[h] = sheetCell(src.hours_post_to_launch);
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
  console.log('  1. File → Import → Upload → backtest-blind-sheet.csv');
  console.log('  2. Separator: Comma · Convert text to numbers: No');
  console.log('  3. Hide column U (mint) after import');
  console.log('  4. View → Freeze → 1 row');
  console.log('  5. Y/N columns: Y, N, or blank');
  console.log('  6. Filter views (Y/N) on the right; reference links in twitter / pumpfun / image');
}

main();
