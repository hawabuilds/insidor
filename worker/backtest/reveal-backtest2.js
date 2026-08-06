#!/usr/bin/env node
'use strict';

/**
 * Reveal report for backtest2 case-control (filled labels + answer key).
 * Run: npm run backtest2:reveal
 */

const fs = require('fs');
const path = require('path');
const { readCsv, BACKTEST_DIR } = require('./lib/blind-csv');

const FILLED_PATH = path.join(BACKTEST_DIR, 'filled-backtest2-blind-sheet.csv');
const ANSWER_PATH = path.join(BACKTEST_DIR, 'backtest2-answers.csv');
const OUT_PATH = path.join(BACKTEST_DIR, 'backtest2-reveal-report.md');

/** Sheet export truncated some headers — map to canonical names. */
const FEATURE_COLS = [
  { col: 'has_character (Y/N)', label: 'has_character' },
  { col: 'works_as_photo (Y/N)', label: 'works_as_photo' },
  { col: 'funny_t_serious (Y/N)', label: 'funny_not_serious' },
  { col: 'others_copying (Y/N)', label: 'others_copying_it' },
  { col: 'crypto_ticed (Y/N)', label: 'crypto_noticed' },
];

const MISSING_FEATURES = ['one_word_name', 'ticker_in_replies'];

function parseNum(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseTernary(v) {
  const s = String(v || '').trim().toLowerCase();
  if (['yes', 'y', '1', 'true'].includes(s)) return 'yes';
  if (['no', 'n', '0', 'false'].includes(s)) return 'no';
  if (['unclear', 'u', '?', 'unknown', 'na', 'n/a'].includes(s)) return 'unclear';
  if (s) return 'unclear';
  return 'missing';
}

function median(nums) {
  const s = nums.filter(n => n != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fmtNum(n, digits = 2) {
  if (n == null) return 'n/a';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtPct(n, d) {
  if (!d) return 'n/a';
  return `${((n / d) * 100).toFixed(1)}%`;
}

function fmtDiffPts(a, b) {
  if (a == null || b == null) return 'n/a';
  const sign = a - b >= 0 ? '+' : '';
  return `${sign}${(a - b).toFixed(1)} pts`;
}

function hasPostUrl(row) {
  return Boolean(String(row.post_url || '').trim());
}

function normPlatform(p) {
  return String(p || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isXPlatform(p) {
  const n = normPlatform(p);
  return n === 'x' || n === 'twitter' || n.startsWith('x ');
}

function yesRate(rows, col) {
  const parsed = rows.map(r => parseTernary(r[col]));
  const usable = parsed.filter(v => v === 'yes' || v === 'no');
  const yes = usable.filter(v => v === 'yes').length;
  return {
    yes,
    usable: usable.length,
    excluded: parsed.length - usable.length,
    rate: usable.length ? (yes / usable.length) * 100 : null,
  };
}

function distTable(rows, col) {
  const counts = {};
  for (const row of rows) {
    const raw = String(row[col] || '').trim();
    const v = raw || '(blank)';
    counts[v] = (counts[v] || 0) + 1;
  }
  return counts;
}

function markdownDist(counts) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ') || 'n/a';
}

function smallNFlag(n) {
  return n < 5 ? ' ⚠ n<5' : '';
}

function joinRows(filled, answers) {
  const answerById = Object.fromEntries(answers.map(r => [String(r.row_id), r]));
  return filled
    .filter(r => answerById[String(r.row_id)])
    .map(r => ({ ...r, ...answerById[String(r.row_id)] }));
}

function buildReport(joined) {
  const lines = [];
  const push = s => lines.push(s);

  const winners = joined.filter(r => String(r.group).toLowerCase() === 'winner');
  const losers = joined.filter(r => String(r.group).toLowerCase() === 'loser');
  const viral = joined.filter(hasPostUrl);
  const viralWinners = viral.filter(r => String(r.group).toLowerCase() === 'winner');
  const viralLosers = viral.filter(r => String(r.group).toLowerCase() === 'loser');
  const viralX = viral.filter(r => isXPlatform(r.origin_platform));
  const viralOther = viral.filter(r => r.origin_platform && !isXPlatform(r.origin_platform));

  push('# Backtest2 Reveal Report');
  push('');
  push(`Generated: ${new Date().toISOString()}`);
  push(`Joined rows: **${joined.length}** (${winners.length} winners · ${losers.length} losers)`);
  push('');
  push('> **Descriptive only — not statistically significant.** Case-control design (218 vs 218). Small subgroups (especially viral-origin n=38) cannot support strong inference. Cells flagged ⚠ when usable n<5.');
  push('');

  // Q1
  push('## 1. Viral origin vs outcome group');
  push('');
  push('Viral origin = row has a non-empty `post_url`. Base rate in this sample: **50%** winners (218/436).');
  push('');
  push('| Metric | Value |');
  push('| --- | --- |');
  push(`| Rows with viral origin | ${viral.length} (${fmtPct(viral.length, joined.length)} of 436) — 38 have judgement labels |`);
  push(`| └ X platform | ${viralX.length} |`);
  push(`| └ Other platform | ${viralOther.length} |`);
  push(`| Viral + WINNER | **${viralWinners.length}** (${fmtPct(viralWinners.length, viral.length)} of viral) |`);
  push(`| Viral + LOSER | **${viralLosers.length}** (${fmtPct(viralLosers.length, viral.length)} of viral) |`);
  push(`| vs 50% base rate | ${fmtDiffPts((viralWinners.length / viral.length) * 100, 50)} winner share |`);
  push('');

  const allWinners = joined.filter(r => String(r.group).toLowerCase() === 'winner');
  const allLosers = joined.filter(r => String(r.group).toLowerCase() === 'loser');
  push('For context — non-viral rows:');
  push(`- No post_url + winner: ${allWinners.filter(r => !hasPostUrl(r)).length}`);
  push(`- No post_url + loser: ${allLosers.filter(r => !hasPostUrl(r)).length}`);
  push('');

  // Q2
  push('## 2. Judgement yes-rates — winners vs losers');
  push('');
  push('Excludes `unclear` and blank. **Judgement columns were only filled where an origin was found** (38 rows with yes/no labels: 19 winners · 19 losers). Non-viral rows have blank judgements.');
  push('');
  if (MISSING_FEATURES.length) {
    push(`*Note: \`${MISSING_FEATURES.join('`, `')}\` were truncated in the Google Sheets export header and are not available in the filled file.*`);
    push('');
  }
  push('| Feature | Winners yes-rate | n | Losers yes-rate | n | Δ (win−lose) |');
  push('| --- | ---: | ---: | ---: | ---: | ---: |');

  for (const { col, label } of FEATURE_COLS) {
    const w = yesRate(winners, col);
    const l = yesRate(losers, col);
    const wFlag = smallNFlag(w.usable);
    const lFlag = smallNFlag(l.usable);
    push(
      `| ${label} | ${w.rate != null ? fmtPct(w.yes, w.usable) : 'n/a'}${wFlag} | ${w.usable} | ${l.rate != null ? fmtPct(l.yes, l.usable) : 'n/a'}${lFlag} | ${l.usable} | ${fmtDiffPts(w.rate, l.rate)} |`,
    );
  }
  push('');

  push('### Viral-origin only (same 38 rows — only rows with judgements filled)');
  push('');
  push('| Feature | Winner yes-rate | n | Loser yes-rate | n | Δ |');
  push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const { col, label } of FEATURE_COLS) {
    const w = yesRate(viralWinners, col);
    const l = yesRate(viralLosers, col);
    push(
      `| ${label} | ${w.rate != null ? fmtPct(w.yes, w.usable) : 'n/a'}${smallNFlag(w.usable)} | ${w.usable} | ${l.rate != null ? fmtPct(l.yes, l.usable) : 'n/a'}${smallNFlag(l.usable)} | ${l.usable} | ${fmtDiffPts(w.rate, l.rate)} |`,
    );
  }
  push('');

  // Q3
  push('## 3. Timing & platform splits');
  push('');
  const hasHours = joined.some(r => String(r.hours_post_to_launch || '').trim());
  const hasMedia = joined.some(r => String(r.media_type || '').trim());

  if (!hasHours) {
    push('*`hours_post_to_launch` was not collected in the filled backtest2 sheet — median not available.*');
  }
  if (!hasMedia) {
    push('*`media_type` was not collected in the filled backtest2 sheet — split not available.*');
  }
  push('');

  push('### origin_platform (all rows)');
  push('');
  push('| Platform | Winners | Losers |');
  push('| --- | ---: | ---: |');
  const platforms = [...new Set(joined.map(r => normPlatform(r.origin_platform)).filter(Boolean))].sort();
  for (const p of platforms) {
    const wN = winners.filter(r => normPlatform(r.origin_platform) === p).length;
    const lN = losers.filter(r => normPlatform(r.origin_platform) === p).length;
    push(`| ${p} | ${wN}${smallNFlag(wN)} | ${lN}${smallNFlag(lN)} |`);
  }
  const blankW = winners.filter(r => !normPlatform(r.origin_platform)).length;
  const blankL = losers.filter(r => !normPlatform(r.origin_platform)).length;
  push(`| (no platform) | ${blankW} | ${blankL} |`);
  push('');

  if (hasHours) {
    push('### hours_post_to_launch (median)');
    push('');
    push('| Group | Median hours | n |');
    push('| --- | ---: | ---: |');
    for (const [label, rows] of [
      ['Winners', winners],
      ['Losers', losers],
      ['Viral winners', viralWinners],
      ['Viral losers', viralLosers],
    ]) {
      const hrs = rows.map(r => parseNum(r.hours_post_to_launch)).filter(n => n != null);
      push(`| ${label} | ${fmtNum(median(hrs), 1)} | ${hrs.length}${smallNFlag(hrs.length)} |`);
    }
    push('');
  }

  if (hasMedia) {
    push('### media_type');
    push('');
    push(`| Group | Distribution |`);
    push(`| --- | --- |`);
    push(`| Winners | ${markdownDist(distTable(winners, 'media_type'))} |`);
    push(`| Losers | ${markdownDist(distTable(losers, 'media_type'))} |`);
    push('');
  }

  push('---');
  push('*Peak multiples and ATH mcap from Dune dex trades (v2 logic). Groups assigned at build time (strict winners vs sampled losers).*');

  return lines.join('\n');
}

function main() {
  if (!fs.existsSync(FILLED_PATH)) {
    console.error(`Missing ${FILLED_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(ANSWER_PATH)) {
    console.error(`Missing ${ANSWER_PATH}`);
    process.exit(1);
  }

  const { rows: filled } = readCsv(FILLED_PATH);
  const { rows: answers } = readCsv(ANSWER_PATH);
  const joined = joinRows(filled, answers);
  if (joined.length !== filled.length) {
    console.warn(`[backtest2:reveal] joined ${joined.length}/${filled.length} rows`);
  }

  const report = buildReport(joined);
  fs.writeFileSync(OUT_PATH, `${report}\n`, 'utf8');
  console.log(report);
  console.log(`\n[backtest2:reveal] wrote ${OUT_PATH}`);
}

main();
