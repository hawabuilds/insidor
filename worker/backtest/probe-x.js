#!/usr/bin/env node
'use strict';

/**
 * One-token X official API probe — prints RAW response + spend, then STOPS.
 * Run BEFORE full stage 2:
 *   npm run backtest:probe-x -- --ticker=WIF --name="dogwifhat" --launch=2026-07-25T12:00:00Z
 *
 * Uses worker/lib/x-official-adapter.js ONLY — never TwitterAPI.io.
 */

const { loadEnvLocal } = require('../lib/env');
const { getServiceClient } = require('../lib/supabase');
const { CONFIG, parseArgs } = require('./lib/config');
const { assertOfficialBudget, recordOfficialReads, COST_PER_READ } = require('./lib/budget-guard');
const { searchOriginatingPost } = require('./lib/post-search');
const { spendSummary } = require('../lib/x-official-adapter');

function parseProbeArgs() {
  const flags = parseArgs();
  const out = { ...flags };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--ticker=')) out.ticker = arg.slice(9);
    if (arg.startsWith('--name=')) out.name = arg.slice(7);
    if (arg.startsWith('--launch=')) out.launch = arg.slice(9);
    if (arg.startsWith('--mint=')) out.mint = arg.slice('--mint='.length);
  }
  if (!out.ticker && !out.name) {
    throw new Error('Provide --ticker= and/or --name= plus --launch= ISO timestamp');
  }
  if (!out.launch) throw new Error('Provide --launch= (ISO) — coin launch time');
  if (!process.env.X_OFFICIAL_BEARER_TOKEN) {
    throw new Error('Missing X_OFFICIAL_BEARER_TOKEN — X Developer Console app-only bearer token');
  }
  return out;
}

async function main() {
  loadEnvLocal();
  const args = parseProbeArgs();
  const sb = getServiceClient();

  const token = {
    mint: args.mint || 'probe',
    ticker: args.ticker,
    name: args.name,
    launch_at: new Date(args.launch).toISOString(),
    outcome: 'winner',
  };

  await assertOfficialBudget({ stage: 'probe-x', projectedReads: 90 });

  console.log('[backtest:probe-x] ONE TOKEN TEST — X API v2 official recent search');
  console.log(`  ticker: ${token.ticker || '—'} · name: ${token.name || '—'} · mint: ${token.mint}`);
  console.log(`  launch: ${token.launch_at} · search window: ${CONFIG.POST_SEARCH_HOURS_BEFORE_LAUNCH}h before`);
  console.log('  Pipeline is STOPPED — this script does not touch ingest/cron.\n');

  const search = await searchOriginatingPost(token, { printRaw: true });

  await recordOfficialReads(sb, {
    runId: null,
    stage: 'probe-x',
    reads: search.tweetsRead,
    cost: search.totalCost || search.tweetsRead * COST_PER_READ,
    note: `probe ${token.ticker || token.name}`,
  });

  const spend = spendSummary();
  console.log('\n=== PROBE RESULT — STOP HERE ===');
  console.log(`queries run: ${search.queriesRun} · billable reads: ${search.tweetsRead}`);
  console.log(`session spend: $${spend.cost.toFixed(2)} / $${spend.budget.toFixed(2)}`);
  if (search.stoppedEarly) console.log('early stop: plausible match found on first qualifying query');

  if (search.best) {
    console.log(`\nbest confidence: ${search.best.confidence.toFixed(2)} (retain threshold: ${CONFIG.MATCH_CONFIDENCE_MIN})`);
    console.log(`reason: ${search.best.reason}`);
    console.log(`url: ${search.best.url || 'n/a'}`);
    console.log(`posted: ${search.best.posted_at || 'n/a'}`);
    console.log(`text: ${search.best.text || ''}`);
  } else {
    console.log('\nNo match in returned posts.');
    if (search.tweetsRead === 0) {
      console.log('⚠ Zero posts returned — confirm launch is within last 7 days and bearer token has search access.');
    }
  }

  console.log('\nDo NOT run backtest:candidates --all until you confirm matches look correct.');
}

main().catch(err => {
  console.error('[backtest:probe-x]', err.message || err);
  if (err.raw) console.error(JSON.stringify(err.raw, null, 2));
  process.exit(1);
});
