#!/usr/bin/env node
'use strict';

/**
 * Merge filled backtest2 + backtest3 blind sheets into one analysis dataset.
 * Run: npm run backtest:merge
 *
 * Defaults:
 *   backtest/filled-backtest2-blind-sheet.csv
 *   backtest/filled-backtest3-blind-sheet.csv  (or backtest3-blind.csv if not filled)
 * Output:
 *   backtest/backtest-merged-blind.csv
 *   backtest/backtest-merged-answers.csv  (if answer keys exist)
 */

const fs = require('fs');
const path = require('path');
const { readCsv, writeCsv, BACKTEST_DIR } = require('./lib/blind-csv');

const BT2_FILLED = path.join(BACKTEST_DIR, 'filled-backtest2-blind-sheet.csv');
const BT3_FILLED = path.join(BACKTEST_DIR, 'filled-backtest3-blind-sheet.csv');
const BT3_BLIND = path.join(BACKTEST_DIR, 'backtest3-blind.csv');
const BT2_ANSWERS = path.join(BACKTEST_DIR, 'backtest2-answers.csv');
const BT3_ANSWERS = path.join(BACKTEST_DIR, 'backtest3-answers.csv');
const OUT_BLIND = path.join(BACKTEST_DIR, 'backtest-merged-blind.csv');
const OUT_ANSWERS = path.join(BACKTEST_DIR, 'backtest-merged-answers.csv');
const OUT_META = path.join(BACKTEST_DIR, 'backtest-merged-meta.json');

/** Normalize sheet/blind column names to a common schema. */
const CANONICAL = [
  'row_id', 'source_wave', 'ticker', 'name', 'description', 'coin_created_at',
  'metadata_twitter', 'x_search_url', 'pumpfun_url', 'mint',
  'origin_platform', 'post_url', 'one_word_name', 'has_character',
  'works_as_photo', 'funny_not_serious', 'others_copying_it',
  'crypto_noticed', 'ticker_in_replies', 'match_confidence', 'notes',
];

const ALIASES = {
  me: 'name',
  created: 'coin_created_at',
  twitter: 'metadata_twitter',
  x_search: 'x_search_url',
  pumpfun: 'pumpfun_url',
  'has_character (Y/N)': 'has_character',
  'works_as_photo (Y/N)': 'works_as_photo',
  'funny_not_serious (Y/N)': 'funny_not_serious',
  'funny_t_serious (Y/N)': 'funny_not_serious',
  'others_copying (Y/N)': 'others_copying_it',
  'crypto_noticed (Y/N)': 'crypto_noticed',
  'crypto_ticed (Y/N)': 'crypto_noticed',
  'ticker_in_replies (Y/N)': 'ticker_in_replies',
  'one_word (Y/N)': 'one_word_name',
  coin_created_at: 'coin_created_at',
  metadata_twitter: 'metadata_twitter',
  x_search_url: 'x_search_url',
  pumpfun_url: 'pumpfun_url',
};

function mintFromPumpfun(url) {
  const m = String(url || '').match(/pump\.fun\/([1-9A-HJ-NP-Za-km-z]{32,44})/);
  return m ? m[1] : '';
}

function normalizeRow(src, sourceWave) {
  const out = {};
  for (const h of CANONICAL) out[h] = '';
  out.source_wave = sourceWave;
  for (const [k, v] of Object.entries(src)) {
    const key = ALIASES[k] || k;
    if (CANONICAL.includes(key)) out[key] = v ?? '';
  }
  if (!out.mint) out.mint = mintFromPumpfun(out.pumpfun_url);
  return out;
}

function loadBlind(filePath, sourceWave) {
  if (!fs.existsSync(filePath)) return { headers: CANONICAL, rows: [] };
  const { rows } = readCsv(filePath);
  return {
    headers: CANONICAL,
    rows: rows.map(r => normalizeRow(r, sourceWave)),
  };
}

function renumber(rows, startId = 1) {
  return rows.map((r, i) => ({ ...r, row_id: String(startId + i) }));
}

function main() {
  const bt2Path = process.argv[2] && fs.existsSync(process.argv[2]) ? process.argv[2] : BT2_FILLED;
  const bt3Path = process.argv[3] && fs.existsSync(process.argv[3])
    ? process.argv[3]
    : (fs.existsSync(BT3_FILLED) ? BT3_FILLED : BT3_BLIND);

  if (!fs.existsSync(bt2Path)) {
    console.error(`Missing backtest2 filled file: ${bt2Path}`);
    process.exit(1);
  }
  if (!fs.existsSync(bt3Path)) {
    console.error(`Missing backtest3 file: ${bt3Path}`);
    process.exit(1);
  }

  const bt2 = loadBlind(bt2Path, 'backtest2');
  const bt3 = loadBlind(bt3Path, 'backtest3');
  const merged = renumber([...bt2.rows, ...renumber(bt3.rows, 1)], 1);

  writeCsv(OUT_BLIND, {
    commentLines: [
      `Merged backtest2 + backtest3 · ${merged.length} rows · ${new Date().toISOString()}`,
      'source_wave column tags which wave each row came from.',
    ],
    headers: CANONICAL,
    rows: merged,
  });

  const answerRows = [];
  if (fs.existsSync(BT2_ANSWERS)) {
    const { rows } = readCsv(BT2_ANSWERS);
    for (const r of rows) answerRows.push({ ...r, source_wave: 'backtest2' });
  }
  if (fs.existsSync(BT3_ANSWERS)) {
    const { rows } = readCsv(BT3_ANSWERS);
    for (const r of rows) answerRows.push({ ...r, source_wave: 'backtest3' });
  }
  if (answerRows.length) {
    const headers = ['row_id', 'peak_multiple', 'ath_mcap', 'liquidity_now', 'group', 'source_wave'];
    writeCsv(OUT_ANSWERS, {
      commentLines: ['Merged answer key — join on row_id + source_wave'],
      headers,
      rows: answerRows.map((r, i) => ({ ...r, row_id: String(i + 1) })),
    });
  }

  const meta = {
    merged_at: new Date().toISOString(),
    backtest2_path: bt2Path,
    backtest2_rows: bt2.rows.length,
    backtest3_path: bt3Path,
    backtest3_rows: bt3.rows.length,
    total_rows: merged.length,
    out_blind: OUT_BLIND,
    out_answers: answerRows.length ? OUT_ANSWERS : null,
  };
  fs.writeFileSync(OUT_META, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  console.log(`[backtest:merge] backtest2: ${bt2.rows.length} rows`);
  console.log(`[backtest:merge] backtest3: ${bt3.rows.length} rows`);
  console.log(`[backtest:merge] merged:  ${merged.length} rows → ${OUT_BLIND}`);
  if (answerRows.length) console.log(`[backtest:merge] answers: ${answerRows.length} → ${OUT_ANSWERS}`);
}

main();
