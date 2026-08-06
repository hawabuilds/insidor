#!/usr/bin/env node
'use strict';

/**
 * Spot-check Dune peak multiples vs DexScreener for random RAN mints.
 * Run: node worker/backtest/spot-check-peaks.js
 */

const fs = require('fs');
const path = require('path');
const { loadEnvLocal } = require('../lib/env');
const { pickBestPair, isPumpFunPair } = require('../../lib/token-lookup');
const { BACKTEST_DIR } = require('./lib/blind-csv');

loadEnvLocal();

const DEX_TOKENS = 'https://api.dexscreener.com/latest/dex/tokens/';
const CHECKPOINT = path.join(BACKTEST_DIR, 'backtest2-peak-count-checkpoint.json');
const SEED = Number(process.env.BACKTEST2_SEED) || 42;
const WINDOW_DAYS = Number(process.env.BACKTEST2_WINDOW_DAYS) || 30;
const WINNER_PEAK = Number(process.env.BACKTEST2_WINNER_PEAK) || 10;
const SAMPLE_N = Number(process.env.BACKTEST2_SPOT_CHECK_N) || 10;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededSample(items, n, seed) {
  const rng = mulberry32(seed);
  return [...items].sort(() => rng() - 0.5).slice(0, n);
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (r.status === 429) {
    await new Promise(x => setTimeout(x, 2000));
    return fetchJson(url);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function fmt(n, digits = 2) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toFixed(digits);
}

function pickDexPair(pairs, mint) {
  const pool = (pairs || []).filter(p => (p.chainId || p.chain) === 'solana' && p.baseToken?.address === mint);
  if (!pool.length) return null;
  const pumpswap = pool.filter(p => String(p.dexId || '').toLowerCase() === 'pumpswap');
  const ranked = pumpswap.length ? pumpswap : pool.filter(isPumpFunPair).length ? pool.filter(isPumpFunPair) : pool;
  return pickBestPair(ranked, { mint });
}

function dexPeakMultiple(pair, priceAtGrad) {
  if (!pair || !priceAtGrad || priceAtGrad <= 0) return null;
  const priceUsd = Number(pair.priceUsd);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  const fdv = Number(pair.fdv || pair.marketCap);
  const athMcap = Number.isFinite(fdv) && fdv > 0 ? fdv : null;
  const gradMcap = priceAtGrad * 1e9;
  const currentMultiple = priceUsd / priceAtGrad;
  const currentMcapMultiple = athMcap && gradMcap > 0 ? athMcap / gradMcap : null;
  return {
    price_usd: priceUsd,
    fdv: fdv || null,
    liquidity_usd: Number(pair.liquidity?.usd) || null,
    dex_id: pair.dexId || null,
    pair_created_at: pair.pairCreatedAt ? new Date(Number(pair.pairCreatedAt)).toISOString() : null,
    /** Current price / Dune graduation price (DexScreener now vs Dune grad baseline). */
    current_multiple_vs_grad: currentMultiple,
    /** Current FDV / implied grad mcap (1B supply). */
    current_mcap_multiple_vs_grad: currentMcapMultiple,
  };
}

async function main() {
  if (!fs.existsSync(CHECKPOINT)) {
    throw new Error(`Missing ${CHECKPOINT} — run npm run backtest2:count first`);
  }
  const cp = JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8'));
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
  const inWin = cp.rows.filter(r => r.graduatedMs >= cutoff);

  const winners = inWin.filter(r => r.peak_multiple != null && r.peak_multiple >= WINNER_PEAK);
  const losers = inWin.filter(r => r.peak_multiple != null && r.peak_multiple < 1.5);
  const unknown = inWin.filter(r => r.peak_multiple == null);

  console.log(`\n=== BACKTEST2 · 30-DAY THRESHOLD COUNTS ===`);
  console.log(`Window:              last ${WINDOW_DAYS} days`);
  console.log(`Graduations:         ${inWin.length}`);
  console.log(`Peak unknown:        ${unknown.length}`);
  console.log(`WINNERS (≥${WINNER_PEAK}×):       ${winners.length}`);
  console.log(`LOSERS (<1.5×):      ${losers.length}`);
  console.log(`Middle (1.5×–${WINNER_PEAK}×):  ${inWin.length - winners.length - losers.length - unknown.length}`);
  console.log('');

  if (winners.length < 200) {
    console.log(`⚠ Only ${winners.length} winners at ≥${WINNER_PEAK}× — below 200 minimum for 150+150 sample.`);
    console.log('   Recommend widening the window rather than lowering the threshold.');
    console.log('');
  } else {
    console.log(`✓ ${winners.length} winners ≥${WINNER_PEAK}× — enough for 150+150 sample (150 each, seed ${SEED}).`);
    console.log('');
  }

  const sample = seededSample(winners, Math.min(SAMPLE_N, winners.length), SEED);
  console.log(`=== SPOT-CHECK · ${sample.length} random winners (seed ${SEED}) vs DexScreener ===`);
  console.log('Dune peak = max trade price / first post-grad trade price.');
  console.log('DexScreener columns use current pair data (price & FDV now vs Dune grad baseline).\n');

  const rows = [];
  for (const row of sample) {
    let dex = null;
    let err = null;
    try {
      const body = await fetchJson(`${DEX_TOKENS}${encodeURIComponent(row.mint)}`);
      const pair = pickDexPair(body.pairs || [], row.mint);
      dex = dexPeakMultiple(pair, row.price_at_graduation);
    } catch (e) {
      err = e.message;
    }
    rows.push({ row, dex, err });
    await new Promise(x => setTimeout(x, 300));
  }

  console.log(
    'ticker'.padEnd(12),
    'dune_peak'.padStart(10),
    'dune_ath$'.padStart(10),
    'dex_now×'.padStart(10),
    'dex_fdv$'.padStart(10),
    'dex_liq$'.padStart(10),
    'dex',
  );
  console.log('-'.repeat(100));

  for (const { row, dex, err } of rows) {
    const ticker = (row.ticker || row.mint.slice(0, 6)).slice(0, 11);
    if (err || !dex) {
      console.log(
        ticker.padEnd(12),
        fmt(row.peak_multiple, 1).padStart(10),
        fmt(row.ath_mcap, 0).padStart(10),
        'n/a'.padStart(10),
        'n/a'.padStart(10),
        'n/a'.padStart(10),
        err || 'no pair',
      );
      continue;
    }
    console.log(
      ticker.padEnd(12),
      fmt(row.peak_multiple, 1).padStart(10),
      fmt(row.ath_mcap, 0).padStart(10),
      fmt(dex.current_multiple_vs_grad, 1).padStart(10),
      fmt(dex.fdv, 0).padStart(10),
      fmt(dex.liquidity_usd, 0).padStart(10),
      dex.dex_id || '',
    );
  }

  console.log('\nNotes:');
  console.log('- dex_now× = DexScreener priceUsd / Dune price_at_graduation (current, not ATH).');
  console.log('- Dumped coins show dex_now× << dune_peak; still-near-peak coins align better.');
  console.log('- Dune peak uses on-chain trade highs; DexScreener has no historical ATH in API.');
  console.log('\nSTOP — confirm labels look sound before building backtest2-blind.csv.');
}

main().catch(err => {
  console.error('[spot-check]', err.message || err);
  process.exit(1);
});
