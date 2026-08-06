#!/usr/bin/env node
'use strict';

/**
 * Reveal report for merged backtest2+3 (enriched labels + answers).
 * Run: npm run backtest:reveal-merged
 */

const fs = require('fs');
const path = require('path');
const { readCsv, BACKTEST_DIR } = require('./lib/blind-csv');

const ENRICHED_PATH = path.join(BACKTEST_DIR, 'backtest-merged-enriched.csv');
const OUT_PATH = path.join(BACKTEST_DIR, 'backtest-merged-reveal-report.md');

const FEATURE_COLS = [
  { col: 'one_word_name', label: 'one_word_name' },
  { col: 'has_character', label: 'has_character' },
  { col: 'works_as_photo', label: 'works_as_photo' },
  { col: 'funny_not_serious', label: 'funny_not_serious' },
  { col: 'others_copying_it', label: 'others_copying_it' },
  { col: 'crypto_noticed', label: 'crypto_noticed' },
  { col: 'ticker_in_replies', label: 'ticker_in_replies' },
];

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

function buildReport(rows) {
  const lines = [];
  const push = s => lines.push(s);

  const winners = rows.filter(r => String(r.group).toLowerCase() === 'winner');
  const losers = rows.filter(r => String(r.group).toLowerCase() === 'loser');
  const viral = rows.filter(hasPostUrl);
  const viralWinners = viral.filter(r => String(r.group).toLowerCase() === 'winner');
  const viralLosers = viral.filter(r => String(r.group).toLowerCase() === 'loser');
  const viralX = viral.filter(r => isXPlatform(r.origin_platform));
  const viralOther = viral.filter(r => r.origin_platform && !isXPlatform(r.origin_platform));
  const b2 = rows.filter(r => r.source_wave === 'backtest2');
  const b3 = rows.filter(r => r.source_wave === 'backtest3');
  const baseRate = winners.length / rows.length;

  push('# Merged Backtest Reveal Report (backtest2 + backtest3)');
  push('');
  push(`Generated: ${new Date().toISOString()}`);
  push(`Rows: **${rows.length}** (${winners.length} winners · ${losers.length} losers · ${fmtPct(winners.length, rows.length)} base rate)`);
  push(`Waves: backtest2 **${b2.length}** · backtest3 **${b3.length}**`);
  push('');
  push('> **Descriptive only — not statistically significant.** Case-control design. Small subgroups (especially viral-origin) cannot support strong inference. Cells flagged ⚠ when usable n<5.');
  push('');

  push('## 1. Viral origin vs outcome group');
  push('');
  push('Viral origin = row has a non-empty `post_url`.');
  push('');
  push('| Metric | Value |');
  push('| --- | --- |');
  push(`| Rows with viral origin | ${viral.length} (${fmtPct(viral.length, rows.length)} of ${rows.length}) |`);
  push(`| └ X platform | ${viralX.length} |`);
  push(`| └ Other platform | ${viralOther.length} |`);
  push(`| Viral + WINNER | **${viralWinners.length}** (${fmtPct(viralWinners.length, viral.length)} of viral) |`);
  push(`| Viral + LOSER | **${viralLosers.length}** (${fmtPct(viralLosers.length, viral.length)} of viral) |`);
  push(`| vs ${fmtPct(winners.length, rows.length)} base rate | ${fmtDiffPts((viralWinners.length / viral.length) * 100, baseRate * 100)} winner share |`);
  push('');

  push('### By wave');
  push('');
  push('| Wave | Viral | Viral winners | Viral losers | Winner share |');
  push('| --- | ---: | ---: | ---: | ---: |');
  for (const [wave, subset] of [['backtest2', b2], ['backtest3', b3]]) {
    const v = subset.filter(hasPostUrl);
    const vw = v.filter(r => String(r.group).toLowerCase() === 'winner');
    const vl = v.filter(r => String(r.group).toLowerCase() === 'loser');
    push(`| ${wave} | ${v.length} | ${vw.length} | ${vl.length} | ${v.length ? fmtPct(vw.length, v.length) : 'n/a'} |`);
  }
  push('');

  push('## 2. Judgement yes-rates — winners vs losers');
  push('');
  push('Excludes `unclear` and blank. Judgement columns typically filled only where an origin was found.');
  push('');
  push('| Feature | Winners yes-rate | n | Losers yes-rate | n | Δ (win−lose) |');
  push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const { col, label } of FEATURE_COLS) {
    const w = yesRate(winners, col);
    const l = yesRate(losers, col);
    push(
      `| ${label} | ${w.rate != null ? fmtPct(w.yes, w.usable) : 'n/a'}${smallNFlag(w.usable)} | ${w.usable} | ${l.rate != null ? fmtPct(l.yes, l.usable) : 'n/a'}${smallNFlag(l.usable)} | ${l.usable} | ${fmtDiffPts(w.rate, l.rate)} |`,
    );
  }
  push('');

  push('### Viral-origin only');
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

  push('## 3. Enrichment & timing');
  push('');
  const enriched = viral.filter(r => String(r.enrich_method || '').trim() && r.enrich_method !== 'skipped' && r.enrich_method !== 'failed');
  const enrichFailed = viral.filter(r => r.enrich_method === 'failed');
  const enrichSkipped = viral.filter(r => r.enrich_method === 'skipped');
  push(`| Metric | Value |`);
  push(`| --- | --- |`);
  push(`| Enriched successfully | ${enriched.length} / ${viral.length} viral |`);
  push(`| Failed | ${enrichFailed.length} |`);
  push(`| Skipped | ${enrichSkipped.length} |`);
  push('');

  const enrichMethods = distTable(viral, 'enrich_method');
  if (Object.keys(enrichMethods).length) {
    push(`Enrich methods (viral rows): ${markdownDist(enrichMethods)}`);
    push('');
  }

  push('### author_followers (median, viral rows)');
  push('');
  push('| Group | Median followers | n |');
  push('| --- | ---: | ---: |');
  for (const [label, subset] of [
    ['Viral winners', viralWinners],
    ['Viral losers', viralLosers],
  ]) {
    const fol = subset.map(r => parseNum(r.author_followers)).filter(n => n != null);
    push(`| ${label} | ${fmtNum(median(fol), 0)} | ${fol.length}${smallNFlag(fol.length)} |`);
  }
  push('');

  push('### hours_post_to_launch (median)');
  push('');
  push('| Group | Median hours | n |');
  push('| --- | ---: | ---: |');
  for (const [label, subset] of [
    ['Winners', winners],
    ['Losers', losers],
    ['Viral winners', viralWinners],
    ['Viral losers', viralLosers],
  ]) {
    const hrs = subset.map(r => parseNum(r.hours_post_to_launch)).filter(n => n != null);
    push(`| ${label} | ${fmtNum(median(hrs), 1)} | ${hrs.length}${smallNFlag(hrs.length)} |`);
  }
  push('');

  push('### media_type');
  push('');
  push('| Group | Distribution |');
  push('| --- | --- |');
  push(`| Winners | ${markdownDist(distTable(winners, 'media_type'))} |`);
  push(`| Losers | ${markdownDist(distTable(losers, 'media_type'))} |`);
  push(`| Viral winners | ${markdownDist(distTable(viralWinners, 'media_type'))} |`);
  push(`| Viral losers | ${markdownDist(distTable(viralLosers, 'media_type'))} |`);
  push('');

  push('### origin_platform (all rows)');
  push('');
  push('| Platform | Winners | Losers |');
  push('| --- | ---: | ---: |');
  const platforms = [...new Set(rows.map(r => normPlatform(r.origin_platform)).filter(Boolean))].sort();
  for (const p of platforms) {
    const wN = winners.filter(r => normPlatform(r.origin_platform) === p).length;
    const lN = losers.filter(r => normPlatform(r.origin_platform) === p).length;
    push(`| ${p} | ${wN}${smallNFlag(wN)} | ${lN}${smallNFlag(lN)} |`);
  }
  const blankW = winners.filter(r => !normPlatform(r.origin_platform)).length;
  const blankL = losers.filter(r => !normPlatform(r.origin_platform)).length;
  push(`| (no platform) | ${blankW} | ${blankL} |`);
  push('');

  push('---');
  push('*Peak multiples and ATH mcap from Dune dex trades (v2 logic). Groups assigned at build time. Enrichment: syndication + X official fallback.*');

  return lines.join('\n');
}

function main() {
  if (!fs.existsSync(ENRICHED_PATH)) {
    console.error(`Missing ${ENRICHED_PATH} — run npm run backtest:enrich-merged first`);
    process.exit(1);
  }

  const { rows } = readCsv(ENRICHED_PATH);
  const report = buildReport(rows);
  fs.writeFileSync(OUT_PATH, `${report}\n`, 'utf8');
  console.log(report);
  console.log(`\n[backtest:reveal-merged] wrote ${OUT_PATH}`);
}

main();
