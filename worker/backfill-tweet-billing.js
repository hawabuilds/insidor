#!/usr/bin/env node
'use strict';

/**
 * Backfill worker_usage + worker_budget_state after API-call → tweet billing fix.
 * Run: npm run backfill:tweet-billing
 */

const fs = require('fs');
const path = require('path');
const { t, c, cs, row: dbRow } = require('../lib/db-schema');
const { loadEnvLocal } = require('./lib/env');
const { CONFIG } = require('./adapters/x/budget');

async function main() {
  loadEnvLocal();
  const mult = CONFIG.TWEETS_PER_CALL_ESTIMATE;
  const costPerTweet = CONFIG.COST_PER_TWEET;
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  const sqlPath = path.join(__dirname, 'schema-tweet-billing.sql');

  if (!dbUrl) {
    const { getServiceClient } = require('./lib/supabase');
    const sb = getServiceClient();

    const { data: usageRows } = await sb.from(t('worker_usage')).select('*').eq(c('worker_usage', 'source'), 'x');
    for (const usageRow of usageRows || []) {
      if (!usageRow.reads_today || usageRow.reads_today >= 5000) continue;
      const tweets = Math.round(usageRow.reads_today * mult);
      await sb.from(t('worker_usage')).update(dbRow('worker_usage', {
        reads_today: tweets,
        cost_usd: tweets * costPerTweet,
        updated_at: new Date().toISOString(),
      })).eq(c('worker_usage', 'source'), 'x').eq(c('worker_usage', 'utc_date'), usageRow.utc_date);
      console.log(`[backfill] worker_usage x ${usageRow.utc_date}: ${usageRow.reads_today} → ${tweets} tweets`);
    }

    const { data: state } = await sb.from(t('worker_budget_state')).select('*').eq(c('worker_budget_state', 'id'), 1).maybeSingle();
    if (state?.reads_today > 0 && state.reads_today < 5000) {
      const tweets = Math.round(state.reads_today * mult);
      await sb.from(t('worker_budget_state')).update(dbRow('worker_budget_state', {
        reads_today: tweets,
        updated_at: new Date().toISOString(),
      })).eq(c('worker_budget_state', 'id'), 1);
      console.log(`[backfill] worker_budget_state: ${state.reads_today} → ${tweets} tweets`);
    }

    const { data: cycles } = await sb
      .from(t('worker_cycle_log'))
      .select(cs('worker_cycle_log', 'id', 'reads_consumed'))
      .not(c('worker_cycle_log', 'reads_consumed'), 'is', null)
      .lt(c('worker_cycle_log', 'reads_consumed'), 500);
    for (const cycleRow of cycles || []) {
      const tweets = Math.round(cycleRow.reads_consumed * mult);
      await sb.from(t('worker_cycle_log')).update(dbRow('worker_cycle_log', { reads_consumed: tweets })).eq(c('worker_cycle_log', 'id'), cycleRow.id);
    }
    if (cycles?.length) {
      console.log(`[backfill] worker_cycle_log: ${cycles.length} rows ×${mult}`);
    }

    console.log(`[backfill] done via Supabase (×${mult} estimate, $${costPerTweet}/tweet)`);
    console.log(`[backfill] apply schema manually if hourly columns missing: ${sqlPath}`);
    return;
  }

  let pg;
  try {
    pg = require('pg');
  } catch {
    console.error('Install pg first: npm install pg');
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query(sql);
    console.log('[backfill:tweet-billing] applied worker/schema-tweet-billing.sql');
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
