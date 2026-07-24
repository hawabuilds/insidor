#!/usr/bin/env node
'use strict';

/** Budget report — today / 7-day / projected month. Run: npm run budget */

const { getServiceClient } = require('./lib/supabase');
const {
  CONFIG,
  loadState,
  costUsd,
  getHistory,
  cycleBudget,
} = require('./lib/budget');
const { loadEnvLocal } = require('./lib/env');

async function main() {
  loadEnvLocal();
  const sb = getServiceClient();
  const state = await loadState(sb);
  const history = await getHistory(sb, 7);

  const byDay = new Map();
  for (const row of history) {
    const day = row.ran_at.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, 0);
    byDay.set(day, byDay.get(day) + (row.reads_consumed || 0));
  }

  const todayTweets = state.reads_today || 0;
  const todayPct = ((todayTweets / CONFIG.DAILY_TWEET_BUDGET) * 100).toFixed(1);
  const ingestPerCycle = cycleBudget('ingest', CONFIG.INGEST_POLL_MS);
  const snapPerCycle = cycleBudget('snapshotter', CONFIG.SNAPSHOT_POLL_MS);
  const projectedMonth = todayTweets * 30;
  const projectedCost = costUsd(projectedMonth);

  console.log('');
  console.log('Insidor X API tweet budget (twitterapi.io bills per tweet returned)');
  console.log('────────────────────────────────────────');
  console.log(`Daily tweet budget   ${CONFIG.DAILY_TWEET_BUDGET.toLocaleString()} tweets (~$${(CONFIG.DAILY_TWEET_BUDGET * CONFIG.COST_PER_TWEET).toFixed(2)})`);
  console.log(`Cost per tweet       $${CONFIG.COST_PER_TWEET} ($0.15 / 1k tweets)`);
  console.log(`Hourly cap           ${CONFIG.MAX_TWEETS_PER_HOUR.toLocaleString()} tweets (DAILY/12)`);
  console.log(`Max pages/lane       ${CONFIG.MAX_PAGES_PER_LANE}`);
  console.log(`Adaptive floor       ${state.adaptive_floor} (min ${state.floor_min})`);
  console.log('');
  console.log('── Today (UTC) ──');
  console.log(`  tweets             ${todayTweets.toLocaleString()} / ${CONFIG.DAILY_TWEET_BUDGET.toLocaleString()} (${todayPct}%)`);
  console.log(`  spend              ~$${costUsd(todayTweets).toFixed(2)}`);
  console.log(`  ingest/cycle cap   ~${ingestPerCycle} tweets (60%)`);
  console.log(`  snapshot/cycle cap ~${snapPerCycle} tweets (40%)`);
  console.log('');
  console.log('── Last 7 days ──');
  if (byDay.size === 0) {
    console.log('  (no worker_cycle_log reads_consumed yet — run schema-budget.sql)');
  } else {
    for (const [day, tweets] of [...byDay.entries()].sort()) {
      console.log(`  ${day}  ${tweets.toLocaleString()} tweets (~$${costUsd(tweets).toFixed(2)})`);
    }
  }
  console.log('');
  console.log('── Projection ──');
  console.log(`  if today repeats   ~${projectedMonth.toLocaleString()} tweets/mo (~$${projectedCost.toFixed(2)})`);
  console.log('────────────────────────────────────────');
  console.log('');
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
