#!/usr/bin/env node
'use strict';

/**
 * Trends worker — velocity metrics for open clusters + Google Trends (SerpAPI) enrichment.
 * Run: node worker/trends.js
 */

const { getServiceClient } = require('./lib/supabase');
const { enrichPost, buildViewSeries, aggregateViewsMetrics, gain24hFromSeries } = require('./lib/cluster-engine');
const { lifecycleFromViewsMetrics } = require('./lib/velocity');
const { oldestPostCreatedMs } = require('./lib/posted-at');
const { deriveTrendTerm } = require('./lib/trend-term');
const {
  fetchGoogleTrends,
  getCachedTrend,
  setCachedTrend,
  canSpendTrendCall,
  recordTrendCall,
  getTrendBudgetState,
  CONFIG: TRENDS_CONFIG,
} = require('./lib/serp-trends');
const { logCycle } = require('./lib/cycle-log');
const { sleep } = require('./lib/retry');
const { loadEnvLocal } = require('./lib/env');
const { TRENDS_MS: POLL_MS } = require('./lib/pipeline-intervals');
const RECENT_MS = 6 * 60 * 60 * 1000;

async function loadOpenNarratives(sb) {
  const { data, error } = await sb
    .from('narratives')
    .select(`
      id,
      narrative_posts!narrative_posts_narrative_id_fkey (
        id, text, handle, platform, first_seen_at, posted_at, views,
        post_meme_scores ( meme_score, suggested_ticker, suggested_name ),
        post_snapshots ( captured_at, views, likes, retweets, replies, quotes, unavailable )
      )
    `)
    .eq('source', 'cluster')
    .eq('status', 'open');

  if (error) throw new Error('trends select: ' + error.message);
  return data || [];
}

async function loadTrendCandidates(sb) {
  const sinceMs = Date.now() - RECENT_MS;
  const { data, error } = await sb
    .from('narratives')
    .select('id, title, combined_views, display_eligible, created_at')
    .or(`display_eligible.eq.true,created_at.gte.${sinceMs}`)
    .order('combined_views', { ascending: false, nullsFirst: false });

  if (error) throw new Error('trend candidates: ' + error.message);
  return data || [];
}

async function refreshVelocityMetrics(sb) {
  const rows = await loadOpenNarratives(sb);
  const nowIso = new Date().toISOString();
  let updated = 0;

  for (const row of rows) {
    const posts = (row.narrative_posts || []).map(enrichPost);
    if (!posts.length) continue;

    const series = buildViewSeries(posts);
    const postViewSum = posts.reduce((s, p) => s + (p.latestViews || 0), 0);
    const combined_views = postViewSum || (series.length ? series[series.length - 1] : 0);
    const gain_24h = gain24hFromSeries(series);
    const { views_velocity, accel, engagement_velocity } = aggregateViewsMetrics(posts);
    const lifecycle = lifecycleFromViewsMetrics(views_velocity, accel);

    const oldest = oldestPostCreatedMs(posts) ?? Date.now();
    const age_min = Math.max(1, Math.round((Date.now() - oldest) / 60000));

    const { error } = await sb
      .from('narratives')
      .update({
        combined_views,
        gain_24h,
        views_velocity,
        accel,
        engagement_velocity,
        lifecycle,
        age_min,
        updated_at: nowIso,
      })
      .eq('id', row.id);

    if (error) {
      console.warn(`[trends] velocity ${row.id}:`, error.message);
      continue;
    }
    updated += 1;
  }

  return { updated, open: rows.length };
}

async function writeTrendFailure(sb, id, term, reason) {
  console.warn(`[trends] "${term}" (${id}): ${reason}`);
  const { error } = await sb
    .from('narratives')
    .update({
      trend_term: term || null,
      search_series: null,
      trend_peak: null,
      trend_direction: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) console.warn(`[trends] failure write ${id}:`, error.message);
}

async function writeTrendSuccess(sb, id, term, result) {
  const { error } = await sb
    .from('narratives')
    .update({
      trend_term: term,
      search_series: result.series,
      trend_peak: result.peak,
      trend_direction: result.direction,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

async function enrichGoogleTrends(sb) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    console.warn('[trends] SERPAPI_KEY missing — skipping Google Trends enrichment');
    return { enriched: 0, failed: 0, cached: 0, apiCalls: 0, skipped: true };
  }

  const rows = await loadTrendCandidates(sb);
  if (!rows.length) return { enriched: 0, failed: 0, cached: 0, apiCalls: 0, candidates: 0 };

  const byTerm = new Map();
  for (const row of rows) {
    const term = deriveTrendTerm(row.title);
    if (!term) continue;
    if (!byTerm.has(term)) byTerm.set(term, []);
    byTerm.get(term).push(row);
  }

  const termEntries = [...byTerm.entries()].sort((a, b) => {
    const maxA = Math.max(...a[1].map(n => Number(n.combined_views) || 0));
    const maxB = Math.max(...b[1].map(n => Number(n.combined_views) || 0));
    return maxB - maxA;
  });

  let enriched = 0;
  let failed = 0;
  let cached = 0;
  let apiCalls = 0;
  const budget = getTrendBudgetState();

  for (const [term, narrs] of termEntries) {
    let result = getCachedTrend(term);

    if (result) {
      cached += 1;
    } else if (!canSpendTrendCall()) {
      console.log(
        `[trends] daily SerpAPI cap (${budget.maxCalls}) — skip "${term}" ` +
        `(${narrs.length} narratives, views≤${Number(narrs[0]?.combined_views) || 0})`,
      );
      continue;
    } else {
      try {
        result = await fetchGoogleTrends(term, apiKey);
        setCachedTrend(term, result);
        recordTrendCall();
        apiCalls += 1;
        console.log(
          `[trends] SerpAPI "${term}" → peak ${result.peak} ${result.direction} ` +
          `(${result.series.length} pts)`,
        );
      } catch (e) {
        for (const n of narrs) {
          await writeTrendFailure(sb, n.id, term, e.message);
          failed += 1;
        }
        continue;
      }
    }

    for (const n of narrs) {
      try {
        await writeTrendSuccess(sb, n.id, term, result);
        enriched += 1;
      } catch (e) {
        await writeTrendFailure(sb, n.id, term, e.message);
        failed += 1;
      }
    }
  }

  const after = getTrendBudgetState();
  console.log(
    `[trends] Google — candidates ${rows.length}, terms ${termEntries.length}, ` +
    `enriched ${enriched}, cached ${cached}, api ${apiCalls}, failed ${failed}, ` +
    `budget ${after.callsToday}/${after.maxCalls}`,
  );

  return { enriched, failed, cached, apiCalls, candidates: rows.length, terms: termEntries.length };
}

async function runCycle(sb) {
  const velocity = await refreshVelocityMetrics(sb);
  const google = await enrichGoogleTrends(sb);

  console.log(
    `[trends] cycle — open ${velocity.open} · velocity refreshed ${velocity.updated}`,
  );

  await logCycle(sb, 'trends', {
    refreshed: velocity.updated,
    open: velocity.open,
    trend_enriched: google.enriched,
    trend_api_calls: google.apiCalls,
    trend_cached: google.cached,
    trend_failed: google.failed,
  });

  return { velocity, google };
}

async function main() {
  loadEnvLocal();
  const once = process.argv.includes('--once');
  const sb = getServiceClient();

  console.log(
    `[trends] every ${POLL_MS / 60000}m — velocity (open clusters) + Google Trends ` +
    `(SerpAPI cap ${TRENDS_CONFIG.MAX_TRENDS_CALLS_PER_DAY}/day, cache ${TRENDS_CONFIG.CACHE_TTL_MS / 60000}m)`,
  );

  if (once) {
    await runCycle(sb);
    return;
  }

  for (;;) {
    try {
      await runCycle(sb);
    } catch (e) {
      console.error('[trends] cycle error:', e.message);
    }
    await sleep(POLL_MS);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { runCycle, POLL_MS, enrichGoogleTrends, refreshVelocityMetrics };
