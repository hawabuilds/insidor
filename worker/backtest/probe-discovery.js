#!/usr/bin/env node
'use strict';
const { loadEnvLocal } = require('../lib/env');
const { CONFIG } = require('./lib/config');
const { discoverFromGraduated } = require('./lib/token-source');

async function main() {
  loadEnvLocal();
  const cutoff = Date.now() - CONFIG.LOOKBACK_DAYS * 86_400_000;
  console.log(`mode=${CONFIG.DISCOVERY_MODE} lookback=${CONFIG.LOOKBACK_DAYS}d cap=${CONFIG.MAX_DISCOVERY_CANDIDATES}\n`);
  const hits = (await discoverFromGraduated(cutoff, CONFIG.SEED_MINTS)).hits;
  const keys = hits.map(h => (h.ticker || '').toUpperCase());
  const unique = new Set(keys.filter(Boolean)).size;
  console.log(`\nFinal: ${hits.length} candidates · ${unique} unique tickers`);
  console.log('Top 10:', hits.slice(0, 10).map(h =>
    `$${h.ticker || '?'} $${Math.round(h.liq)} ${new Date(h.launchMs).toISOString().slice(0, 10)}`,
  ).join('\n  '));
}

main().catch(e => { console.error(e); process.exit(1); });
