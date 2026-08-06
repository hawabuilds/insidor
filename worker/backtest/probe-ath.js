#!/usr/bin/env node
'use strict';
/** Quick ATH probe for calibration mints (default: GeckoTerminal). */
const { loadEnvLocal } = require('../lib/env');
const { CONFIG } = require('./lib/config');
const { enrichMint, classifyOutcome } = require('./lib/token-source');
const { resolveNarrativeCohort } = require('./lib/narrative-cohort');

async function main() {
  loadEnvLocal();
  console.log(
    `ATH source: ${CONFIG.ATH_OHLCV_SOURCE} · window ${CONFIG.OHLCV_HOURS_AFTER_LAUNCH}h · ` +
    `${CONFIG.SEED_MINTS.length} seed mints\n`,
  );
  for (const mint of CONFIG.SEED_MINTS) {
    try {
      const t = await enrichMint(mint, null);
      const outcome = classifyOutcome(t);
      const cohort = resolveNarrativeCohort(mint);
      console.log(
        `${outcome.toUpperCase()} $${t.ticker} [${cohort}] ${Number(t.peak_multiple).toFixed(2)}x · ` +
        `peak mcap $${Math.round(t.peak_mcap || 0)} · source=${t.source}`,
      );
    } catch (e) {
      console.log(`FAIL ${mint.slice(0, 8)}… ${e.message}`);
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
