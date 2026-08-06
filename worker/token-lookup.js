#!/usr/bin/env node
'use strict';

/** Backfill narrative_tickers from DexScreener / pump.fun. Run: npm run token-lookup */

const { getServiceClient } = require('./lib/supabase');
const { enrichAllOpenTickers } = require('./cluster/lib/enrich-tickers');
const { loadEnvLocal } = require('./lib/env');

async function main() {
  loadEnvLocal();
  const force = process.argv.includes('--force');
  const sb = getServiceClient();

  console.log(`[token-lookup] scanning narrative_tickers${force ? ' (force)' : ''}…`);
  const { checked, found, updated } = await enrichAllOpenTickers(sb, { force });

  console.log(`[token-lookup] done — checked ${checked}, found on-chain ${found}, updated ${updated}`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
