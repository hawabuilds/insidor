#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { readCsv, writeCsv, BACKTEST_DIR } = require('./lib/blind-csv');
const { toIpfsIoGateway } = require('./lib/ipfs-url');

const BLIND_PATH = path.join(BACKTEST_DIR, 'backtest-blind.csv');

function readCommentLines(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const comments = [];
  for (const line of lines) {
    if (line.trim().startsWith('#')) comments.push(line.replace(/^#\s?/, ''));
    else if (line.trim()) break;
  }
  return comments;
}

function main() {
  const commentLines = readCommentLines(BLIND_PATH);
  const { headers, rows } = readCsv(BLIND_PATH);
  let changed = 0;
  for (const row of rows) {
    const before = row.image_url || '';
    const after = toIpfsIoGateway(before);
    if (after !== before) {
      row.image_url = after;
      changed += 1;
    }
  }
  writeCsv(BLIND_PATH, { commentLines, headers, rows });
  console.log(`Updated ${changed} image_url values in ${BLIND_PATH}`);
}

main();
