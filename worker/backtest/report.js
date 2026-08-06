#!/usr/bin/env node
'use strict';

/**
 * Stage 4 — distribution report + threshold simulation.
 * Run: npm run backtest:report
 */

const { loadEnvLocal } = require('../lib/env');
const { getServiceClient } = require('../lib/supabase');
const { t, c } = require('../../lib/db-schema');
const { CONFIG, parseArgs } = require('./lib/config');
const { latestRunForStage } = require('./lib/persist');

const FEATURE_KEYS = [
  'views_at_t',
  'view_velocity_t',
  'acceleration_t',
  'author_followers',
  'engagement_rate_t',
  'distinct_authors_t',
  'age_min_when_seen',
  'meme_score',
];

function quantile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function distribution(rows, key) {
  const vals = rows.map(r => Number(r[key])).filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!vals.length) return null;
  return {
    n: vals.length,
    min: vals[0],
    p25: quantile(vals, 0.25),
    median: quantile(vals, 0.5),
    p75: quantile(vals, 0.75),
    max: vals[vals.length - 1],
  };
}

function fmtDist(d) {
  if (!d) return '—';
  const f = v => (v == null ? '—' : typeof v === 'number' && v < 10 ? v.toFixed(3) : Math.round(v).toLocaleString());
  return `n=${d.n} min=${f(d.min)} p25=${f(d.p25)} med=${f(d.median)} p75=${f(d.p75)} max=${f(d.max)}`;
}

function separationScore(wDist, lDist) {
  if (!wDist || !lDist) return 0;
  const wMed = wDist.median;
  const lMed = lDist.median;
  const spread = Math.max(wDist.p75 - wDist.p25, lDist.p75 - lDist.p25, 1e-9);
  return Math.abs(wMed - lMed) / spread;
}

function simulateThresholds(rows) {
  const th = CONFIG.CURRENT_THRESHOLDS;
  let winnersCaught = 0;
  let winnersMissed = 0;
  let losersLetThrough = 0;
  let losersBlocked = 0;

  for (const r of rows) {
    const views = Number(r.views_at_t) || 0;
    const meme = Number(r.meme_score);
    const passIngest = views >= th.MIN_INGEST_VIEWS;
    const passMeme = !Number.isFinite(meme) || meme >= th.MEME_MIN_X;
    const passDisplay = views >= th.MIN_DISPLAY_VIEWS;
    const pass = passIngest && passMeme && passDisplay;

    if (r.outcome === 'winner') {
      if (pass) winnersCaught += 1;
      else winnersMissed += 1;
    } else if (r.outcome === 'loser') {
      if (pass) losersLetThrough += 1;
      else losersBlocked += 1;
    }
  }
  return { winnersCaught, winnersMissed, losersLetThrough, losersBlocked, thresholds: th };
}

async function main() {
  loadEnvLocal();
  const flags = parseArgs();
  const sb = getServiceClient();

  const featRun = flags.runId
    ? { id: flags.runId }
    : await latestRunForStage(sb, 'features');
  if (!featRun?.id) throw new Error('No features run — run npm run backtest:features first');

  const { data: rows, error } = await sb
    .from(t('backtest_post_features'))
    .select('*')
    .eq(c('backtest_post_features', 'run_id'), featRun.id);
  if (error) throw new Error(error.message);

  const winners = (rows || []).filter(r => r.outcome === 'winner');
  const losers = (rows || []).filter(r => r.outcome === 'loser');

  console.log('\n=== STAGE 4 · BACKTEST REPORT ===');
  console.log(`features run_id: ${featRun.id}`);
  console.log(`samples: ${winners.length} winners · ${losers.length} losers\n`);

  const separations = [];
  console.log('Feature distributions (WINNERS vs LOSERS):');
  console.log('-'.repeat(90));
  for (const key of FEATURE_KEYS) {
    const w = distribution(winners, key);
    const l = distribution(losers, key);
    const sep = separationScore(w, l);
    separations.push({ key, sep, w, l });
    console.log(`${key.padEnd(22)} WIN  ${fmtDist(w)}`);
    console.log(`${''.padEnd(22)} LOSS ${fmtDist(l)}`);
    console.log(`${''.padEnd(22)} sep  ${sep.toFixed(2)}\n`);
  }

  separations.sort((a, b) => b.sep - a.sep);
  console.log('Best separators (median gap / IQR):');
  for (const s of separations.slice(0, 5)) {
    console.log(`  ${s.key}: ${s.sep.toFixed(2)}`);
  }

  const sim = simulateThresholds(rows || []);
  console.log('\nCurrent threshold simulation:');
  console.log(`  MIN_INGEST_VIEWS=${sim.thresholds.MIN_INGEST_VIEWS} · MEME_MIN_X=${sim.thresholds.MEME_MIN_X} · MIN_DISPLAY_VIEWS=${sim.thresholds.MIN_DISPLAY_VIEWS}`);
  console.log(`  winners caught: ${sim.winnersCaught} · winners missed: ${sim.winnersMissed}`);
  console.log(`  losers let through: ${sim.losersLetThrough} · losers blocked: ${sim.losersBlocked}`);

  const seen = (rows || []).filter(r => r.in_narrative_posts).length;
  const winnersSeen = winners.filter(r => r.in_narrative_posts).length;
  const winnersMissedPipeline = winners.length - winnersSeen;
  console.log('\nPipeline visibility:');
  console.log(`  retained posts in narrative_posts: ${seen}/${rows?.length || 0}`);
  console.log(`  winners we saw: ${winnersSeen}/${winners.length}`);
  console.log(`  winners never ingested: ${winnersMissedPipeline} (${winners.length ? Math.round(100 * winnersMissedPipeline / winners.length) : 0}%)`);

  if (winners.length && losers.length) {
    const wViews = winners.map(r => Number(r.views_at_t)).filter(Number.isFinite).sort((a, b) => a - b);
    const suggestViews = Math.round((quantile(wViews, 0.25) || CONFIG.MIN_INGEST_VIEWS) / 1000) * 1000;
    console.log('\nSuggested starting points (data-derived, review manually):');
    console.log(`  MIN_INGEST_VIEWS ≈ ${suggestViews || CONFIG.MIN_INGEST_VIEWS} (winner p25 views@T+30)`);
  }
}

main().catch(err => {
  console.error('[backtest:report]', err.message || err);
  process.exit(1);
});
