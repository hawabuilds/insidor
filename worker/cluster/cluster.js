#!/usr/bin/env node
'use strict';

/**
 * Cluster scored posts into open narratives (cashtag → keyword → embedding).
 * Run: node worker/cluster.js
 * Test: node worker/cluster.js --once
 */

const { getServiceClient } = require('../lib/supabase');
const { t, c, cs, row: dbRow, REL } = require('../../lib/db-schema');
const {
  enrichPost,
  matchPostToNarrative,
  deriveNarrative,
  newNarrativeId,
  applyDisplayGate,
} = require('./lib/cluster-engine');
const { upsertNarrative, assignPosts, upsertTickers, closeEmptyNarratives, closeAgedOutNarratives } = require('./lib/cluster-persist');
const { enrichNarrativeTickers } = require('./lib/enrich-tickers');
const { formatViewsVelocityDist } = require('../lib/dist-stats');
const { missingViewsStats } = require('../lib/velocity');
const { computeNarrativeReplication, extractSubjectEntity } = require('./lib/replication');
const { isTikTokVelocityUnreliable } = require('../snapshot/lib/tt-view-diagnostic');
const { sleep } = require('../lib/retry');
const { loadEnvLocal } = require('../lib/env');
const { shouldRegenNarrativeCopy } = require('./lib/narrative-copy');
const { loadUsage, formatBudgetLine } = require('../adapters/anthropic/budget');
const { CLUSTER_MS: POLL_MS } = require('../lib/pipeline-intervals');
const { MEME_MIN_X, MEME_MIN_TT, CROSS_PLATFORM_DISCOUNT } = require('../score/lib/meme-gate');

/* ── tuning config ───────────────────────────────────────────────────────── */
const CONFIG = {
  WINDOW_HOURS: 24,
  SIM_THRESHOLD: 0.42,
  KEYWORD_OVERLAP_THRESHOLD: 0.28,
  /** Narratives below this combined_views stay in pipeline but off the Narratives tab. */
  MIN_DISPLAY_VIEWS: 200_000,
  /** Per-platform mins + cross-platform discount applied in deriveNarrative. */
  MEME_MIN_X,
  MEME_MIN_TT,
  CROSS_PLATFORM_DISCOUNT,
  /** Newest member post age — X default 12h; TikTok-only uses 72h. */
  MAX_NARRATIVE_AGE_MIN: Number(process.env.MAX_NARRATIVE_AGE_MIN) || 720,
  MAX_NARRATIVE_AGE_MIN_TT: Number(process.env.MAX_NARRATIVE_AGE_MIN_TT) || 4320,
  /** Max X entity searches per cluster cycle (replication signal). */
  X_REPLICATION_SEARCHES_PER_CYCLE: Number(process.env.X_REPLICATION_SEARCHES_PER_CYCLE) || 5,
  /** Flag bought reach — filter only, not a ranking input. */
  MIN_ENGAGEMENT_RATE: 0.005,
  /** Cross-platform narratives (X + TikTok) get ranking boost. */
  CROSS_PLATFORM_ORGANIC_BOOST: 25,
  /** Max Claude title regens per cluster cycle (rest use cached/fallback). */
  ANTHROPIC_TITLES_PER_CYCLE: Number(process.env.ANTHROPIC_TITLES_PER_CYCLE) || 8,
};
/* ─────────────────────────────────────────────────────────────────────────── */

async function loadScoredPosts(sb, sinceIso) {
  const { data, error } = await sb
    .from(t('narrative_posts'))
    .select(`
      ${cs('narrative_posts', 'id', 'text', 'handle', 'platform', 'filter_label', 'first_seen_at', 'posted_at', 'narrative_id', 'views', 'replies', 'quotes', 'likes', 'retweets', 'sound_id', 'sample_replies', 'raw')},
      post_meme_scores!inner ( ${cs('post_meme_scores', 'meme_score', 'suggested_ticker', 'suggested_name', 'scored_at')} ),
      post_snapshots ( ${cs('post_snapshots', 'captured_at', 'views', 'likes', 'retweets', 'replies', 'quotes', 'unavailable')} )
    `)
    .in(c('narrative_posts', 'platform'), ['x', 'tt'])
    .not(c('narrative_posts', 'platform_post_id'), 'is', null)
    .gte(c('narrative_posts', 'first_seen_at'), sinceIso);

  if (error) throw new Error('load scored posts: ' + error.message);

  return (data || []).map(p => ({
    ...p,
    post_meme_scores: Array.isArray(p.post_meme_scores)
      ? p.post_meme_scores[0]
      : p.post_meme_scores,
  }));
}

async function loadOpenNarratives(sb) {
  const { data, error } = await sb
    .from(t('narratives'))
    .select(`
      ${cs('narratives', 'id', 'title', 'blurb', 'source', 'status')},
      narrative_posts!${REL.narrative_posts_narrative_id_fkey} (
        ${cs('narrative_posts', 'id', 'text', 'handle', 'platform', 'first_seen_at', 'posted_at', 'views', 'sound_id', 'sample_replies', 'raw')},
        post_meme_scores ( ${cs('post_meme_scores', 'meme_score', 'suggested_ticker', 'suggested_name')} ),
        post_snapshots ( ${cs('post_snapshots', 'captured_at', 'views', 'likes', 'retweets', 'replies', 'quotes', 'unavailable')} )
      )
    `)
    .eq(c('narratives', 'source'), 'cluster')
    .eq(c('narratives', 'status'), 'open');

  if (error) throw new Error('load open narratives: ' + error.message);

  return (data || []).map(row => {
    const memberPosts = (row.narrative_posts || []).map(enrichPost);
    return {
      id: row.id,
      title: row.title,
      blurb: row.blurb,
      memberPosts,
      centroid: null,
    };
  });
}

function groupPostsByNarrative(posts) {
  const map = new Map();
  for (const p of posts) {
    if (!p.narrative_id) continue;
    if (!map.has(p.narrative_id)) map.set(p.narrative_id, []);
    map.get(p.narrative_id).push(enrichPost(p));
  }
  return map;
}

async function runCycle(sb, opts = {}) {
  const timeGuard = opts.timeGuard;
  let assignIndex = Number(opts.progress?.assignIndex) || 0;
  let finalizeIndex = Number(opts.progress?.finalizeIndex) || 0;
  const phase = opts.progress?.phase || 'assign';

  await require('../snapshot/lib/tt-view-diagnostic').hydrateTtDiagnostic(sb);

  const sinceIso = new Date(Date.now() - CONFIG.WINDOW_HOURS * 3600000).toISOString();
  const scoredPosts = (await loadScoredPosts(sb, sinceIso)).map(enrichPost);
  let openNarratives = await loadOpenNarratives(sb);

  const closedAgedIds = await closeAgedOutNarratives(sb, openNarratives, {
    maxNarrativeAgeMin: CONFIG.MAX_NARRATIVE_AGE_MIN,
    maxNarrativeAgeMinTt: CONFIG.MAX_NARRATIVE_AGE_MIN_TT,
  });
  if (closedAgedIds.length) {
    console.log(
      `[cluster] closed aged-out: ${closedAgedIds.length} narratives ` +
      `(status=closed, gate=too_old — newest post older than max narrative age)`,
    );
  }
  const closedAgedSet = new Set(closedAgedIds);
  openNarratives = openNarratives.filter(n => !closedAgedSet.has(n.id));

  let titleRegensLeft = CONFIG.ANTHROPIC_TITLES_PER_CYCLE;

  const unassigned = scoredPosts.filter(p => !p.narrative_id);
  let merges = 0;
  let created = 0;
  const createdIds = new Set();
  const mergeLog = [];
  const membersAddedByNarr = new Map();
  const activeIds = new Set();

  const sorted = unassigned.slice().sort((a, b) => (b.memeScore || 0) - (a.memeScore || 0));

  if (phase !== 'finalize') {
    for (let i = assignIndex; i < sorted.length; i += 1) {
      if (timeGuard?.shouldStop()) {
        return {
          merges,
          created,
          active: activeIds.size,
          timedOut: true,
          progress: { phase: 'assign', assignIndex: i, finalizeIndex: 0 },
        };
      }
      const post = sorted[i];
    const hit = matchPostToNarrative(
      post,
      openNarratives,
      CONFIG.KEYWORD_OVERLAP_THRESHOLD,
      CONFIG.SIM_THRESHOLD,
    );

    if (hit) {
      post.narrative_id = hit.narrative.id;
      post.cluster_match = hit.reason;
      hit.narrative.memberPosts = hit.narrative.memberPosts || [];
      hit.narrative.memberPosts.push(enrichPost(post));
      membersAddedByNarr.set(
        hit.narrative.id,
        (membersAddedByNarr.get(hit.narrative.id) || 0) + 1,
      );
      merges += 1;
      mergeLog.push(
        `MERGE ${hit.reason} ${hit.detail}: ${post.handle} -> ${hit.narrative.id}`,
      );
    } else {
      const id = newNarrativeId([post]);
      const regenTitle = titleRegensLeft > 0;
      if (regenTitle) titleRegensLeft -= 1;
      const narr = await deriveNarrative(id, [post], {
        sb,
        clusterMatch: 'new',
        regenTitle,
        minDisplayViews: CONFIG.MIN_DISPLAY_VIEWS,
        minEngagementRate: CONFIG.MIN_ENGAGEMENT_RATE,
        maxNarrativeAgeMin: CONFIG.MAX_NARRATIVE_AGE_MIN,
        crossPlatformOrganicBoost: CONFIG.CROSS_PLATFORM_ORGANIC_BOOST,
        crossPlatformVvMult: CONFIG.CROSS_PLATFORM_VV_MULT,
      });
      narr.memberPosts = [enrichPost(post)];
      post.narrative_id = id;
      post.cluster_match = 'new';
      openNarratives.push(narr);
      created += 1;
      createdIds.add(id);
      mergeLog.push(`NEW narrative ${id}: ${post.handle}`);
    }
    }
  }

  for (const line of mergeLog) console.log(`[cluster] ${line}`);

  const assignedByNarr = groupPostsByNarrative(scoredPosts);
  for (const narr of openNarratives) {
    const extra = assignedByNarr.get(narr.id) || [];
    const ids = new Set((narr.memberPosts || []).map(p => p.id));
    for (const p of extra) {
      if (!ids.has(p.id)) {
        narr.memberPosts.push(enrichPost(p));
        ids.add(p.id);
      }
    }
  }

  const sizeLines = [];
  const gateCounts = {
    eligible: 0, below_views: 0, low_meme: 0, no_velocity: 0, no_replication: 0,
  };
  let freshEvalCount = 0;
  let boughtReachCount = 0;
  let crossPlatformCount = 0;
  const narrativeViewsVels = [];
  const narrativeAuthorVels = [];
  const narrFunnel = {
    x: { in: 0, eligible: 0, gates: {} },
    tt: { in: 0, eligible: 0, gates: {} },
  };
  let xSearchBudget = CONFIG.X_REPLICATION_SEARCHES_PER_CYCLE;

  for (let ni = finalizeIndex; ni < openNarratives.length; ni += 1) {
    if (timeGuard?.shouldStop()) {
      return {
        merges,
        created,
        active: activeIds.size,
        timedOut: true,
        progress: { phase: 'finalize', assignIndex: sorted.length, finalizeIndex: ni },
      };
    }
    const narr = openNarratives[ni];
    const members = narr.memberPosts || assignedByNarr.get(narr.id) || [];
    if (!members.length) continue;

    const platKey = [...new Set(members.map(p => p.platform || 'x'))].includes('tt') ? 'tt' : 'x';

    const membersAdded = membersAddedByNarr.get(narr.id) || 0;
    const wantsRegen = shouldRegenNarrativeCopy(members, {
      existingTitle: narr.title,
      existingBlurb: narr.blurb,
      membersAdded,
    });
    const regenTitle = wantsRegen && titleRegensLeft > 0;
    if (regenTitle) titleRegensLeft -= 1;

    const derived = await deriveNarrative(narr.id, members, {
      sb,
      existingTitle: narr.title,
      existingBlurb: narr.blurb,
      membersAdded,
      regenTitle,
      minDisplayViews: CONFIG.MIN_DISPLAY_VIEWS,
      minEngagementRate: CONFIG.MIN_ENGAGEMENT_RATE,
      maxNarrativeAgeMin: CONFIG.MAX_NARRATIVE_AGE_MIN,
      maxNarrativeAgeMinTt: CONFIG.MAX_NARRATIVE_AGE_MIN_TT,
      crossPlatformOrganicBoost: CONFIG.CROSS_PLATFORM_ORGANIC_BOOST,
      crossPlatformVvMult: CONFIG.CROSS_PLATFORM_VV_MULT,
    });
    derived.memberPosts = members.map(p => enrichPost(p));

    const topPost = derived.memberPosts.slice()
      .sort((a, b) => (b.latestViews || b.views || 0) - (a.latestViews || a.views || 0))[0];
    const entity = extractSubjectEntity(topPost);
    const runXSearch = xSearchBudget > 0 && (derived.platforms || []).includes('x');
    const replication = await computeNarrativeReplication(sb, derived.memberPosts, {
      entity,
      runXSearch,
    });
    if (runXSearch && entity) xSearchBudget -= 1;

    Object.assign(derived, replication);

    const finalized = applyDisplayGate(derived, {
      minDisplayViews: CONFIG.MIN_DISPLAY_VIEWS,
      maxNarrativeAgeMin: CONFIG.MAX_NARRATIVE_AGE_MIN,
      maxNarrativeAgeMinTt: CONFIG.MAX_NARRATIVE_AGE_MIN_TT,
      crossPlatformOrganicBoost: CONFIG.CROSS_PLATFORM_ORGANIC_BOOST,
      skipVelocityForTt: isTikTokVelocityUnreliable(),
    });

    if (finalized.gate_reason === 'too_old') {
      finalized.status = 'closed';
      finalized.display_eligible = false;
      await upsertNarrative(sb, finalized);
      closedAgedIds.push(finalized.id);
      continue;
    }

    await upsertNarrative(sb, finalized);
    await assignPosts(sb, finalized.id, finalized.memberPosts);
    await upsertTickers(sb, finalized.id, finalized.tickers);
    try {
      await enrichNarrativeTickers(sb, finalized.id, finalized.tickers);
    } catch (e) {
      console.warn(`[cluster] token-lookup ${finalized.id}:`, e.message);
    }

    activeIds.add(finalized.id);

    const freshEval = createdIds.has(narr.id) || membersAdded > 0;
    if (freshEval) {
      freshEvalCount += 1;
      const reason = finalized.gate_reason || 'below_views';
      gateCounts[reason] = (gateCounts[reason] || 0) + 1;
      narrFunnel[platKey].gates[reason] = (narrFunnel[platKey].gates[reason] || 0) + 1;
      if (finalized.display_eligible) narrFunnel[platKey].eligible += 1;
      narrFunnel[platKey].in += 1;
      sizeLines.push(
        `${finalized.id}="${finalized.title}" posts=${members.length} views=${finalized.combined_views} ` +
        `authors=${finalized.distinct_authors} av=${Number(finalized.author_velocity).toFixed(1)}/h ` +
        `meme=${(finalized.meme_score ?? 0).toFixed(2)}/${(finalized.meme_min ?? CONFIG.MEME_MIN_X).toFixed(2)} ` +
        `vv=${Math.round(finalized.views_velocity)}/min proposals=${finalized.ticker_proposals}` +
        `${finalized.ct_pickup ? ' ct' : ''} [${finalized.gate_reason}]` +
        `${finalized.cross_platform ? ' cross_platform' : ''}`,
      );
    }

    if (finalized.bought_reach) boughtReachCount += 1;
    if (finalized.cross_platform) crossPlatformCount += 1;
    if (finalized.views_velocity > 0) narrativeViewsVels.push(finalized.views_velocity);
    if (finalized.author_velocity > 0) narrativeAuthorVels.push(finalized.author_velocity);
  }

  for (const [plat, f] of Object.entries(narrFunnel)) {
    if (!f.in) continue;
    const gateStr = Object.entries(f.gates).map(([g, c]) => `${c} ${g}`).join(', ');
    console.log(`[cluster] funnel ${plat} (fresh eval): ${f.in} in → ${f.eligible} eligible (${gateStr || 'none'})`);
  }

  const closed = await closeEmptyNarratives(sb);
  const memberPosts = openNarratives.flatMap(n => n.memberPosts || assignedByNarr.get(n.id) || []);
  const viewStats = missingViewsStats(memberPosts);
  if (viewStats.checked > 0 && viewStats.pct >= 10) {
    console.warn(
      `[cluster] ⚠ MISSING viewCount on ${viewStats.pct.toFixed(1)}% of member snapshots ` +
      `(${viewStats.missing}/${viewStats.checked}) — narrative views_velocity is unreliable`,
    );
  }

  console.log(
    `[cluster] cycle — window ${CONFIG.WINDOW_HOURS}h | scored ${scoredPosts.length} | ` +
    `unassigned ${unassigned.length} | merges ${merges} | new ${created} | ` +
    `active ${activeIds.size} (${gateCounts.eligible} display fresh, ${boughtReachCount} bought_reach, ` +
    `${crossPlatformCount} cross_platform) | closed empty ${closed} | closed aged ${closedAgedIds.length}`,
  );
  console.log(
    `[cluster] gate (fresh eval n=${freshEvalCount}): ${gateCounts.eligible} eligible · ` +
    `${gateCounts.below_views} below_views · ${gateCounts.low_meme} low_meme · ` +
    `${gateCounts.no_velocity} no_velocity · ${gateCounts.no_replication || 0} no_replication`,
  );
  console.log(`[cluster] sizes (fresh eval): ${sizeLines.join(' · ') || '(none)'}`);
  console.log(
    `[cluster] narrative views-velocity dist: ${formatViewsVelocityDist(narrativeViewsVels)}`,
  );
  console.log(
    `[cluster] narrative author-velocity dist: ${formatViewsVelocityDist(narrativeAuthorVels)}`,
  );
  console.log(
    `[cluster] thresholds: SIM=${CONFIG.SIM_THRESHOLD} keyword=${CONFIG.KEYWORD_OVERLAP_THRESHOLD} ` +
    `MIN_DISPLAY_VIEWS=${CONFIG.MIN_DISPLAY_VIEWS} MEME_MIN_X=${CONFIG.MEME_MIN_X} ` +
    `MEME_MIN_TT=${CONFIG.MEME_MIN_TT} CROSS_PLATFORM_DISCOUNT=${CONFIG.CROSS_PLATFORM_DISCOUNT} ` +
    `MAX_NARRATIVE_AGE_MIN=${CONFIG.MAX_NARRATIVE_AGE_MIN} ` +
    `MAX_NARRATIVE_AGE_MIN_TT=${CONFIG.MAX_NARRATIVE_AGE_MIN_TT} ` +
    `tt_velocity_disabled=${isTikTokVelocityUnreliable()} ` +
    `MIN_ENGAGEMENT_RATE=${CONFIG.MIN_ENGAGEMENT_RATE} ` +
    `ANTHROPIC_TITLES_PER_CYCLE=${CONFIG.ANTHROPIC_TITLES_PER_CYCLE}`,
  );

  try {
    const anthropicUsage = await loadUsage(sb);
    console.log(`[cluster] ${formatBudgetLine(anthropicUsage)}`);
  } catch (e) {
    console.warn('[cluster] anthropic budget log failed:', e.message);
  }

  return {
    merges,
    created,
    active: activeIds.size,
    closedAged: closedAgedIds.length,
    freshEvalCount,
    timedOut: false,
    progress: null,
  };
}

async function main() {
  loadEnvLocal();
  const once = process.argv.includes('--once');
  const sb = getServiceClient();

  console.log(
    `[cluster] ${once ? 'single run' : 'continuous'} — WINDOW_HOURS=${CONFIG.WINDOW_HOURS}, ` +
    `SIM_THRESHOLD=${CONFIG.SIM_THRESHOLD}, MIN_DISPLAY_VIEWS=${CONFIG.MIN_DISPLAY_VIEWS}, ` +
    `poll ${POLL_MS / 1000}s`,
  );

  if (once) {
    await runCycle(sb);
    return;
  }

  for (;;) {
    try {
      await runCycle(sb);
    } catch (e) {
      console.error('[cluster] cycle error:', e.message);
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

module.exports = { runCycle, CONFIG };
