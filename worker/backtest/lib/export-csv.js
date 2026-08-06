'use strict';

const fs = require('fs');
const path = require('path');
const { t, c } = require('../../../lib/db-schema');

const OUT_DIR = path.join(__dirname, '..', '..', '..', 'backtest', 'out');

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function exportTokensCsv(sb, runId) {
  const { data, error } = await sb
    .from(t('backtest_tokens'))
    .select('*')
    .eq(c('backtest_tokens', 'run_id'), runId)
    .in(c('backtest_tokens', 'outcome'), ['winner', 'loser'])
    .order('outcome')
    .order('launch_at', { ascending: false });
  if (error) throw new Error('csv export: ' + error.message);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const short = runId.slice(0, 8);
  const filePath = path.join(OUT_DIR, `backtest_tokens_${short}.csv`);

  const headers = [
    'outcome', 'narrative_cohort', 'mint', 'ticker', 'name', 'launch_at', 'peak_multiple', 'peak_mcap',
    'current_mcap', 'peak_liquidity', 'holders', 'liquidity_exists', 'liquidity_dead_within_24h', 'source',
  ];
  const lines = [headers.join(',')];
  for (const row of data || []) {
    lines.push(headers.map(h => {
      if (h === 'narrative_cohort') return csvEscape(row.narrative_cohort || row.raw?.narrative_cohort || 'unknown');
      return csvEscape(row[h]);
    }).join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
  return { filePath, count: (data || []).length };
}

module.exports = { exportTokensCsv, OUT_DIR };
