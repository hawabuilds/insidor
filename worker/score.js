#!/usr/bin/env node
'use strict';

/**
 * Meme gate — top N posts by views velocity → Claude scoring.
 * Run: node worker/score.js
 */

const { getServiceClient } = require('./lib/supabase');
const { viewsVelocity, engagementVelocity, missingViewsStats } = require('./lib/velocity');
const { formatViewsVelocityDist } = require('./lib/dist-stats');
const { memeScore, MODEL, MODEL_TT } = require('./lib/meme-score');
const {
  MEME_MIN_X,
  MEME_MIN_TT,
  CROSS_PLATFORM_DISCOUNT,
  memeMinForPost,
  emptyGateStats,
  recordGatePass,
  formatMemeGateLine,
} = require('./lib/meme-gate');
const { sleep } = require('./lib/retry');
const { loadEnvLocal } = require('./lib/env');
const { SCORE_MS: POLL_MS } = require('./lib/pipeline-intervals');
const { postAgeMinutes } = require('./lib/posted-at');
const { FunnelLog } = require('./lib/funnel-log');
const { normalizeTicker } = require('./lib/nameability');
const { evaluateTikTokVisionGate } = require('./lib/tt-score-gate');
const {
  loadUsage,
  isDormant,
  isWarn,
  formatBudgetLine,
  formatMeasuredCosts,
  isCreditError,
  printExhaustionBanner,
  setScoringPaused,
} = require('./lib/anthropic-budget');
const FRESHNESS_MS = 3 * 60 * 60 * 1000;
const SCORE_TOP_N = Number(process.env.SCORE_TOP_N) || 10;
const FAST_LANE_VIEWS = Number(process.env.FAST_LANE_VIEWS) || 500_000;
const FAST_LANE_MAX_AGE_MIN = Number(process.env.FAST_LANE_MAX_AGE_MIN) || 120;
const MISSING_VIEWS_WARN_PCT = 10;

function qualifiesFastLane(post) {
  const views = Number(post.views) || 0;
  if (views < FAST_LANE_VIEWS) return false;
  const age = postAgeMinutes(post);
  return age != null && age <= FAST_LANE_MAX_AGE_MIN;
}

function rankScore(entry) {
  if (entry.viewsVelocity != null) return entry.viewsVelocity;
  if (qualifiesFastLane(entry.post)) return Number(entry.post.views) / 1000;
  return null;
}

async function loadScoredPostIds(sb) {
  const { data, error } = await sb.from('post_meme_scores').select('post_id');
  if (error) throw new Error('load scored ids: ' + error.message);
  return new Set((data || []).map(r => r.post_id));
}

async function loadCandidatePosts(sb) {
  const since = new Date(Date.now() - FRESHNESS_MS).toISOString();
  const { data, error } = await sb
    .from('narrative_posts')
    .select(`
      id, text, handle, platform, filter_label, first_seen_at, posted_at,
      platform_post_id, views, media_url, sound_id, sample_replies, raw,
      post_snapshots (
        captured_at, views, likes, retweets, replies, unavailable
      )
    `)
    .in('platform', ['x', 'tt'])
    .not('platform_post_id', 'is', null)
    .gte('first_seen_at', since)
    .order('first_seen_at', { ascending: false });

  if (error) throw new Error('load posts: ' + error.message);
  return data || [];
}

async function persistScore(sb, postId, viewsVel, engVel, result) {
  const row = {
    post_id: postId,
    meme_score: result.meme_score,
    reason: result.reason,
    suggested_ticker: result.suggested_ticker,
    suggested_name: result.suggested_name,
    velocity: viewsVel,
    views_velocity: viewsVel,
    engagement_velocity: engVel,
    scored_at: new Date().toISOString(),
    model: result.model || MODEL,
    raw: result.raw || null,
  };

  const { error } = await sb.from('post_meme_scores').insert(row);
  if (error) throw new Error('insert score: ' + error.message);

  const entity = normalizeTicker(result.suggested_ticker);
  if (entity) {
    await sb.from('narrative_posts').update({ subject_entity: entity.toLowerCase() }).eq('id', postId);
  }
}

async function runCycle(sb, opts = {}) {
  const force = !!opts.force;
  const timeGuard = opts.timeGuard;
  let scoredIndex = Number(opts.progress?.scoredIndex) || 0;
  const usage = await loadUsage(sb);

  if (isDormant(usage)) {
    printExhaustionBanner(usage, 'anthropic_daily_budget');
    await setScoringPaused(sb, true, 'anthropic_daily_budget').catch(() => {});
    console.log(`[score] ${formatBudgetLine(usage)} — dormant until UTC midnight`);
    return { scored: 0, failures: 0, gateStats: emptyGateStats() };
  }
  if (isWarn(usage)) {
    console.warn(`[score] ${formatBudgetLine(usage)} — nearing daily cap`);
  }

  const scoredIds = await loadScoredPostIds(sb);
  const posts = await loadCandidatePosts(sb);

  const viewStats = missingViewsStats(posts);
  if (viewStats.checked > 0 && viewStats.pct >= MISSING_VIEWS_WARN_PCT) {
    console.warn(`[score] ⚠ MISSING viewCount on ${viewStats.pct.toFixed(1)}% of snapshots`);
  }

  const candidates = posts.filter(p => !scoredIds.has(p.id));
  const ranked = candidates
    .map(p => ({
      post: p,
      viewsVelocity: viewsVelocity(p),
      engagementVelocity: engagementVelocity(p),
    }))
    .filter(x => x.viewsVelocity != null || qualifiesFastLane(x.post))
    .sort((a, b) => (rankScore(b) ?? -1) - (rankScore(a) ?? -1));

  const allViewsVels = ranked.map(x => x.viewsVelocity);
  let top = ranked.slice(0, SCORE_TOP_N);

  if (force) {
    console.warn('[score] ⚠ FORCE MODE — scoring by recency, not views velocity');
    top = candidates
      .slice()
      .sort((a, b) => new Date(b.first_seen_at) - new Date(a.first_seen_at))
      .slice(0, SCORE_TOP_N)
      .map(p => ({
        post: p,
        viewsVelocity: viewsVelocity(p),
        engagementVelocity: engagementVelocity(p),
      }));
  }

  let scored = 0;
  let failures = 0;
  let ttVisionSkipped = 0;
  const gateStats = emptyGateStats();
  const funnel = { x: { pass: 0, fail: 0 }, tt: { pass: 0, fail: 0 } };

  for (let i = scoredIndex; i < top.length; i += 1) {
    if (timeGuard?.shouldStop()) {
      return {
        scored,
        failures,
        gateStats,
        timedOut: true,
        progress: { scoredIndex: i },
      };
    }
    const { post, viewsVelocity: vv, engagementVelocity: ev } = top[i];
    const platform = post.platform === 'tt' ? 'tt' : 'x';
    const memeMin = memeMinForPost(platform);

    if (platform === 'tt') {
      const ttGate = await evaluateTikTokVisionGate(post, sb);
      if (!ttGate.ok) {
        ttVisionSkipped += 1;
        console.log(`[score] tt ${post.handle} vision skip (${ttGate.reason}) — no Claude call`);
        continue;
      }
    }

    try {
      const result = await memeScore(post, sb);
      if (result.scoring_mode === 'budget_skip') {
        printExhaustionBanner(await loadUsage(sb), 'anthropic_daily_budget');
        await setScoringPaused(sb, true, 'anthropic_daily_budget').catch(() => {});
        console.log(`[score] ${formatBudgetLine(await loadUsage(sb))} — stopping cycle`);
        break;
      }
      if (result.scoring_mode === 'tt_budget_skip') {
        printExhaustionBanner(await loadUsage(sb), 'anthropic_daily_budget');
        await setScoringPaused(sb, true, 'anthropic_daily_budget').catch(() => {});
        console.log('[score] Anthropic budget exhausted — stopping cycle');
        break;
      }
      await persistScore(sb, post.id, vv, ev, result);
      scored += 1;
      const passed = result.meme_score >= memeMin;
      recordGatePass(gateStats, platform, passed);
      if (passed) funnel[platform].pass += 1;
      else funnel[platform].fail += 1;
      const platTag = platform === 'tt' ? 'tt' : 'x';
      const modeTag = result.scoring_mode ? ` ${result.scoring_mode}` : '';
      console.log(
        `[score]${force ? ' [FORCE]' : ''} ${platTag} ${post.handle} vv=${Math.round(vv || 0)}/min ` +
        `meme=${result.meme_score.toFixed(2)}${passed ? ' ✓' : ''} ` +
        `(min ${memeMin})${modeTag} $${result.suggested_ticker || '?'}`,
      );
    } catch (e) {
      failures += 1;
      if (isCreditError(e)) {
        printExhaustionBanner(await loadUsage(sb), 'anthropic_credits');
        await setScoringPaused(sb, true, 'anthropic_credits').catch(() => {});
        console.warn('[score] Anthropic credits exhausted — scoring paused (top up account to resume)');
        break;
      }
      console.warn(`[score] ${post.id} failed:`, e.message);
    }
  }

  const finalUsage = await loadUsage(sb);
  console.log(
    `[score] cycle — candidates ${candidates.length}, ranked ${ranked.length}, ` +
    `scored ${scored}/${SCORE_TOP_N}, tt vision skipped ${ttVisionSkipped}, failures ${failures}`,
  );
  console.log(`[score] ${formatBudgetLine(finalUsage)}`);
  console.log(`[score] ${formatMeasuredCosts(finalUsage)}`);
  console.log(`[score] ${formatMemeGateLine(gateStats)}`);
  console.log(`[score] views-velocity dist: ${formatViewsVelocityDist(allViewsVels)}`);
  for (const plat of ['x', 'tt']) {
    const candN = candidates.filter(p => (p.platform === 'tt' ? 'tt' : 'x') === plat).length;
    const rankedN = ranked.filter(x => (x.post.platform === 'tt' ? 'tt' : 'x') === plat).length;
    const f = funnel[plat];
    if (!candN && !f.pass) continue;
    new FunnelLog('score', plat)
      .in(candN)
      .drop('ranked', rankedN)
      .drop('pass_meme', f.pass)
      .out(f.pass)
      .log();
  }

  return { scored, failures, gateStats, timedOut: false, progress: null };
}

async function main() {
  loadEnvLocal();
  if (process.argv.includes('--dry-run-cost')) {
    const { runDryRunCost } = require('./lib/anthropic-budget');
    await runDryRunCost(getServiceClient());
    return;
  }
  const once = process.argv.includes('--once');
  const force = process.argv.includes('--force');
  const sb = getServiceClient();

  console.log(
    `[score] top ${SCORE_TOP_N}/cycle by views velocity (daily budget is the throttle), ` +
    `MEME_MIN_X=${MEME_MIN_X}, MEME_MIN_TT=${MEME_MIN_TT}, CROSS_PLATFORM_DISCOUNT=${CROSS_PLATFORM_DISCOUNT}, ` +
    `FAST_LANE_VIEWS=${FAST_LANE_VIEWS} (≤${FAST_LANE_MAX_AGE_MIN}m), ` +
    `models x=${MODEL} tt=${MODEL_TT}, poll ${POLL_MS / 1000}s`,
  );

  if (once) {
    await runCycle(sb, { force });
    return;
  }

  for (;;) {
    try {
      await runCycle(sb, { force });
    } catch (e) {
      console.error('[score] cycle error:', e.message);
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

module.exports = {
  runCycle,
  MEME_MIN_X,
  MEME_MIN_TT,
  MEME_MIN: MEME_MIN_X,
  SCORE_TOP_N,
  POLL_MS,
};
