#!/usr/bin/env node
'use strict';

/**
 * Backfill worker_usage + worker_budget_state after API-call → tweet billing fix.
 * Run: npm run backfill:tweet-billing
 */

const fs = require('fs');
const path = require('path');
const { loadEnvLocal } = require('./lib/env');
const { CONFIG } = require('./lib/budget');

async function main() {
  loadEnvLocal();
  const mult = CONFIG.TWEETS_PER_CALL_ESTIMATE;
  const costPerTweet = CONFIG.COST_PER_TWEET;
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  const sqlPath = path.join(__dirname, 'schema-tweet-billing.sql');

  if (!dbUrl) {
    const { getServiceClient } = require('./lib/supabase');
    const sb = getServiceClient();

    const { data: usageRows } = await sb.from('worker_usage').select('*').eq('source', 'x');
    for (const row of usageRows || []) {
      if (!row.reads_today || row.reads_today >= 5000) continue;
      const tweets = Math.round(row.reads_today * mult);
      await sb.from('worker_usage').update({
        reads_today: tweets,
        cost_usd: tweets * costPerTweet,
        updated_at: new Date().toISOString(),
      }).eq('source', 'x').eq('utc_date', row.utc_date);
      console.log(`[backfill] worker_usage x ${row.utc_date}: ${row.reads_today} → ${tweets} tweets`);
    }

    const { data: state } = await sb.from('worker_budget_state').select('*').eq('id', 1).maybeSingle();
    if (state?.reads_today > 0 && state.reads_today < 5000) {
      const tweets = Math.round(state.reads_today * mult);
      await sb.from('worker_budget_state').update({
        reads_today: tweets,
        updated_at: new Date().toISOString(),
      }).eq('id', 1);
      console.log(`[backfill] worker_budget_state: ${state.reads_today} → ${tweets} tweets`);
    }

    const { data: cycles } = await sb
      .from('worker_cycle_log')
      .select('id, reads_consumed')
      .not('reads_consumed', 'is', null)
      .lt('reads_consumed', 500);
    for (const row of cycles || []) {
      const tweets = Math.round(row.reads_consumed * mult);
      await sb.from('worker_cycle_log').update({ reads_consumed: tweets }).eq('id', row.id);
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
