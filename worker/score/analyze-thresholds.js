#!/usr/bin/env node
'use strict';

/**
 * Score-band + threshold analysis from rescore validation cache.
 * Run: npm run score:analyze-thresholds
 */

const fs = require('fs');
const path = require('path');

const CACHE_PATH = path.join(__dirname, '..', '..', '.backtest', 'rescore-validation-cache.json');
const OUT_PATH = path.join(__dirname, '..', '..', 'docs', 'rescore-threshold-analysis.md');

/** User-requested bands plus lower fail bands for context. */
const SCORE_BANDS = [
  [0.0, 0.3],
  [0.3, 0.5],
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 0.8],
  [0.8, 0.9],
  [0.9, 1.01],
];

const THRESHOLDS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85];
const VOLUME_THRESHOLDS = [0.6, 0.7, 0.75, 0.8];

/** Defaults calibrated from v2 rescore cache (Aug 2026). Override via env. */
const DEFAULT_MEME_MIN_X = 0.7;
const DEFAULT_MEME_MIN_TT = 0.75;

function pct(n, d) {
  if (!d) return 'n/a';
  return `${((n / d) * 100).toFixed(1)}%`;
}

function platformKind(row) {
  const ps = new Set(row.platforms || []);
  if (ps.has('x') && ps.has('tt')) return 'cross';
  if (ps.has('tt')) return 'tt';
  return 'x';
}

function inBand(score, lo, hi) {
  return score >= lo && score < hi;
}

function bandLabel(lo, hi) {
  if (hi >= 1) return `${lo.toFixed(1)}–1.0`;
  return `${lo.toFixed(1)}–${hi.toFixed(1)}`;
}

function bandTable(rows) {
  const lines = [];
  lines.push('| Score band | Narratives | Coined | Coin rate |');
  lines.push('| --- | ---: | ---: | ---: |');
  for (const [lo, hi] of SCORE_BANDS) {
    const band = rows.filter(r => inBand(r.meme_score, lo, hi));
    const coined = band.filter(r => r.coined).length;
    lines.push(`| ${bandLabel(lo, hi)} | ${band.length} | ${coined} | ${pct(coined, band.length)} |`);
  }
  return lines;
}

function cumulativeTable(rows) {
  const lines = [];
  lines.push('| Threshold (≥) | Would pass | Coined | Coin rate | Δ rate vs prior |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  let prevRate = null;
  for (const t of THRESHOLDS) {
    const pass = rows.filter(r => r.meme_score >= t);
    const coined = pass.filter(r => r.coined).length;
    const rate = pass.length ? coined / pass.length : null;
    const delta = rate != null && prevRate != null
      ? `${rate - prevRate >= 0 ? '+' : ''}${((rate - prevRate) * 100).toFixed(1)} pts`
      : '—';
    lines.push(`| **${t.toFixed(2)}** | ${pass.length} | ${coined} | **${pct(coined, pass.length)}** | ${delta} |`);
    if (rate != null) prevRate = rate;
  }
  return lines;
}

function volumeTradeoff(rows) {
  const lines = [];
  lines.push('| MEME_MIN | Pass count | Pass % of sample | Coined among pass | Coin rate |');
  lines.push('| ---: | ---: | ---: | ---: | ---: |');
  for (const t of VOLUME_THRESHOLDS) {
    const pass = rows.filter(r => r.meme_score >= t);
    const coined = pass.filter(r => r.coined).length;
    lines.push(`| ${t.toFixed(2)} | ${pass.length} | ${pct(pass.length, rows.length)} | ${coined} | ${pct(coined, pass.length)} |`);
  }
  return lines;
}

/** Lowest threshold where pass coin rate ≥65% and fail coin rate ≤5%. */
function findElbowThreshold(rows, candidates = [0.7, 0.65, 0.75, 0.6, 0.8]) {
  for (const t of candidates) {
    const below = rows.filter(r => r.meme_score < t);
    const above = rows.filter(r => r.meme_score >= t);
    if (below.length < 15 || above.length < 15) continue;
    const belowRate = below.filter(r => r.coined).length / below.length;
    const aboveRate = above.filter(r => r.coined).length / above.length;
    if (aboveRate >= 0.65 && belowRate <= 0.05) {
      return {
        t,
        delta: aboveRate - belowRate,
        belowRate,
        aboveRate,
        belowN: below.length,
        aboveN: above.length,
      };
    }
  }
  return null;
}

function main() {
  if (!fs.existsSync(CACHE_PATH)) {
    console.error(`Missing ${CACHE_PATH} — run npm run score -- --rescore first`);
    process.exit(1);
  }

  const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  const all = Object.values(cache.narratives).filter(r => r.meme_score != null);
  const xOnly = all.filter(r => platformKind(r) === 'x' || platformKind(r) === 'cross');
  const ttOnly = all.filter(r => platformKind(r) === 'tt');

  const elbow = findElbowThreshold(all) || findElbowThreshold(xOnly);
  const suggestedX = elbow?.t ?? DEFAULT_MEME_MIN_X;
  const suggestedTt = DEFAULT_MEME_MIN_TT;

  const lines = [];
  const push = s => lines.push(s);

  push('# Rescore threshold analysis');
  push('');
  push(`Generated: ${new Date().toISOString()}`);
  push(`Source: validation cache · **${all.length}** narratives (v2 coinability prompt)`);
  push('');
  push('> Scores cluster at 0.7–0.85 (model rarely outputs higher). The big coined-rate jump is **below vs above 0.7**, not between 0.7 and 0.8.');
  push('');

  push('## Score bands — all narratives');
  push('');
  lines.push(...bandTable(all));
  push('');

  push('### Where the jump is');
  push('');
  if (elbow) {
    push(`At **≥ ${elbow.t.toFixed(2)}**: ${pct(Math.round(elbow.aboveRate * elbow.aboveN), elbow.aboveN)} coined (${elbow.aboveN} narratives)`);
    push(`Below **${elbow.t.toFixed(2)}**: ${pct(Math.round(elbow.belowRate * elbow.belowN), elbow.belowN)} coined (${elbow.belowN} narratives)`);
    push(`Gap: **+${(elbow.delta * 100).toFixed(1)} pts**`);
  }
  push('');
  push('Within the pass range, coin rate is flat (~71–74%) from 0.7 through 0.85 — raising above 0.7 mostly drops volume without improving precision.');
  push('');

  if (ttOnly.length) {
    push('### TikTok-only caveat');
    push('');
    push(`TT-only narratives in this cache (n=${ttOnly.length}) mostly scored **0.4** (thumbnail cap / no vision rescore) — not usable for TT threshold calibration. Keep **MEME_MIN_TT=${suggestedTt.toFixed(2)}** until TT vision rescores are in the validation set.`);
    push('');
  }

  push('## Cumulative coin rate from threshold');
  push('');
  lines.push(...cumulativeTable(all));
  push('');

  push('## Volume tradeoff');
  push('');
  lines.push(...volumeTradeoff(all));
  push('');
  push('| Change | Effect |');
  push('| --- | --- |');
  const at60 = all.filter(r => r.meme_score >= 0.6).length;
  const at70 = all.filter(r => r.meme_score >= 0.7).length;
  const at80 = all.filter(r => r.meme_score >= 0.8).length;
  push(`| 0.60 → 0.70 | −${at60 - at70} passes (${pct(at60 - at70, at60)} of current 0.6 passes), coin rate ~flat |`);
  push(`| 0.70 → 0.80 | −${at70 - at80} passes (${pct(at70 - at80, at70)} of 0.7 passes), +0.1 pts coin rate |`);
  push('');

  push('## Recommended defaults');
  push('');
  push('| Setting | Old default | New default | Why |');
  push('| --- | ---: | ---: | --- |');
  push(`| MEME_MIN_X | 0.60 | **${suggestedX.toFixed(2)}** | Elbow: ~2% coined below vs ~73% at/above |`);
  push(`| MEME_MIN_TT | 0.75 | **${suggestedTt.toFixed(2)}** | Unchanged — TT not calibrated in this cache |`);
  push('');
  push('```env');
  push(`MEME_MIN_X=${suggestedX.toFixed(2)}`);
  push(`MEME_MIN_TT=${suggestedTt.toFixed(2)}`);
  push('```');
  push('');

  const report = lines.join('\n');
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${report}\n`, 'utf8');
  console.log(report);
  console.log(`\n[analyze-thresholds] wrote ${OUT_PATH}`);
  console.log(`[analyze-thresholds] suggested MEME_MIN_X=${suggestedX.toFixed(2)} MEME_MIN_TT=${suggestedTt.toFixed(2)}`);

  return { suggestedX, suggestedTt, elbow };
}

if (require.main === module) {
  main();
}

module.exports = { main, findElbowThreshold, bandTable };
