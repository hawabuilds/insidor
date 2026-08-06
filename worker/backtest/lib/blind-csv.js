'use strict';

const fs = require('fs');
const path = require('path');

const BACKTEST_DIR = path.join(__dirname, '..', '..', '..', 'backtest');

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(filePath, { commentLines = [], headers, rows }) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [];
  for (const c of commentLines) lines.push(c.startsWith('#') ? c : `# ${c}`);
  if (commentLines.length) lines.push('');
  lines.push(headers.join(','));
  for (const row of rows) {
    lines.push(headers.map(h => csvEscape(row[h])).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;

  function pushRow() {
    row.push(cur);
    cur = '';
    const first = (row[0] || '').trim();
    if (first && !first.startsWith('#')) rows.push(row);
    row = [];
  }

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\r') {
      // skip
    } else if (ch === '\n') {
      if (inQ) cur += '\n';
      else pushRow();
    } else {
      cur += ch;
    }
  }
  if (cur.length || row.length) pushRow();
  return rows;
}

function readCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const parsed = parseCsv(text);
  if (!parsed.length) return { headers: [], rows: [] };
  const headers = parsed[0].map(h => h.trim());
  const rows = [];
  for (let i = 1; i < parsed.length; i += 1) {
    const cols = parsed[i];
    const row = {};
    headers.forEach((h, idx) => { row[h] = cols[idx] ?? ''; });
    rows.push(row);
  }
  return { headers, rows };
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

module.exports = { writeCsv, readCsv, csvEscape, BACKTEST_DIR };
