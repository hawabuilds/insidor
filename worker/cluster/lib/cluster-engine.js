'use strict';

const {
  extractCashtags,
  maxKeywordOverlapMatching,
  slugify,
  textForMatching,
  normalizeHandle,
  firstClauseTitle,
} = require('../../lib/text-utils');
const { embedText, cosineSimilarity, averageVectors } = require('./embeddings');
const { generateNarrativeCopy } = require('../../adapters/anthropic/narrative-title');
const { shouldRegenNarrativeCopy, cachedNarrativeCopy } = require('./narrative-copy');
const {
  engagement,
  viewsVelocity,
  engagementVelocity,
  viewsAcceleration,
  lifecycleFromViewsMetrics,
} = require('../../lib/velocity');
const {
  oldestPostCreatedMs,
  newestPostAgeMinutes,
} = require('../../lib/posted-at');
const { memeMinForNarrative } = require('../../score/lib/meme-gate');
const { aggregateNarrativeSignals } = require('./ticker-proposals');
const { isTikTokVelocityUnreliable } = require('../../snapshot/lib/tt-view-diagnostic');

function latestSnapshot(post) {
  const snaps = (post.post_snapshots || [])
    .filter(s => !s.unavailable)
    .slice()
    .sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
  return snaps[0] || null;
}

function latestViews(post) {
  const s = latestSnapshot(post);
  return s?.views ?? post.views ?? 0;
}

function enrichPost(post) {
  const matchText = textForMatching(post.text, post.handle);
  const embedding = post._embedding || embedText(matchText);
  return {
    ...post,
    _embedding: embedding,
    _matchText: matchText,
    latestViews: latestViews(post),
    cashtags: extractCashtags(post.text),
    memeScore: post.post_meme_scores?.meme_score ?? post.meme_score ?? 0,
    suggestedTicker: post.post_meme_scores?.suggested_ticker ?? null,
    suggestedName: post.post_meme_scores?.suggested_name ?? null,
  };
}

function membersShareAuthor(members, handle) {
  const h = normalizeHandle(handle);
  if (!h) return false;
  return (members || []).some(m => normalizeHandle(m.handle) === h);
}

function narrativeCentroid(memberPosts) {
  const vecs = memberPosts.map(p => p._embedding || embedText(p._matchText || textForMatching(p.text, p.handle))).filter(Boolean);
  return averageVectors(vecs);
}

function narrativeCashtags(memberPosts) {
  const set = new Set();
  for (const p of memberPosts) {
    for (const t of p.cashtags || extractCashtags(p.text)) set.add(t);
  }
  return set;
}

/**
 * Match priority: 1 cashtag, 2 keyword overlap (sanitized text), 3 embedding cosine.
 * Same-author posts never merge on keyword/embedding — only shared cashtag.
 * Returns { narrative, reason, score, detail } or null.
 */
function matchPostToNarrative(post, openNarratives, keywordThreshold, simThreshold) {
  const p = enrichPost(post);

  for (const narr of openNarratives) {
    const members = narr.memberPosts || [];
    if (!members.length) continue;

    const nTags = narrativeCashtags(members);
    const shared = (p.cashtags || []).filter(t => nTags.has(t));
    if (shared.length) {
      return {
        narrative: narr,
        reason: 'cashtag',
        score: 1,
        detail: `tag=$${shared[0]}`,
      };
    }
  }

  for (const narr of openNarratives) {
    const members = narr.memberPosts || [];
    if (membersShareAuthor(members, p.handle)) continue;

    const overlap = maxKeywordOverlapMatching(p.text, p.handle, members);
    if (overlap >= keywordThreshold) {
      return {
        narrative: narr,
        reason: 'keyword',
        score: overlap,
        detail: `overlap=${overlap.toFixed(3)}`,
      };
    }
  }

  const pVec = p._embedding || embedText(p._matchText || textForMatching(p.text, p.handle));
  let best = null;
  let bestSim = 0;

  for (const narr of openNarratives) {
    const members = narr.memberPosts || [];
    if (membersShareAuthor(members, p.handle)) continue;

    const centroid = narr.centroid || narrativeCentroid(members);
    if (!centroid) continue;
    const sim = cosineSimilarity(pVec, centroid);
    if (sim >= simThreshold && sim > bestSim) {
      bestSim = sim;
      best = {
        narrative: narr,
        reason: 'embedding',
        score: sim,
        detail: `sim=${sim.toFixed(3)}`,
      };
    }
  }

  return best;
}

function buildViewSeries(posts, bucketMs = 3600000) {
  const buckets = new Map();

  for (const post of posts) {
    for (const snap of post.post_snapshots || []) {
      if (snap.unavailable) continue;
      const t = new Date(snap.captured_at).getTime();
      const bucket = Math.floor(t / bucketMs) * bucketMs;
      const v = snap.views ?? 0;
      buckets.set(bucket, (buckets.get(bucket) || 0) + v);
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, views]) => views);
}

function lifecycleFromSeries(series) {
  if (!series || series.length < 4) return 'peaking';
  const r = series.slice(-4);
  const rSlope = (r[r.length - 1] - r[0]) / Math.max(r[0], 1);
  const mid = (series[Math.floor(series.length / 2)] - series[0]) / Math.max(series[0], 1);
  if (rSlope > 0.12 && mid < 0.45) return 'heating';
  if (rSlope < -0.07) return 'cooling';
  return 'peaking';
}

function aggregateViewsMetrics(posts) {
  let views_velocity = 0;
  let accel = 0;
  let engagement_velocity = 0;
  let evCount = 0;

  for (const post of posts) {
    const vv = viewsVelocity(post);
    const va = viewsAcceleration(post);
    const ev = engagementVelocity(post);
    if (vv != null) views_velocity += vv;
    if (va != null) accel += va;
    if (ev != null) {
      engagement_velocity += ev;
      evCount += 1;
    }
  }

  return {
    views_velocity,
    accel,
    engagement_velocity: evCount ? engagement_velocity / evCount : null,
  };
}

function narrativeEngagementRate(posts) {
  let totalViews = 0;
  let totalEng = 0;

  for (const post of posts) {
    const snap = latestSnapshot(post);
    const views = snap?.views ?? post.views ?? 0;
    const likes = snap?.likes ?? post.likes ?? 0;
    const retweets = snap?.retweets ?? post.retweets ?? 0;
    const replies = snap?.replies ?? post.replies ?? 0;
    totalViews += views;
    totalEng += likes + 2 * retweets + replies;
  }

  if (totalViews <= 0) return null;
  return totalEng / totalViews;
}

function isBoughtReach(combinedViews, engagementRate, minRate) {
  if (combinedViews < 10_000) return false;
  if (engagementRate == null) return false;
  return engagementRate < minRate;
}

function gain24hFromSeries(series) {
  if (!series.length) return 0;
  const latest = series[series.length - 1];
  const idx24 = Math.max(0, series.length - 25);
  const prior = series[idx24];
  return Math.max(0, latest - prior);
}

function isCrossPlatform(platforms) {
  const set = new Set(platforms || []);
  return set.has('x') && set.has('tt');
}

function organicScore(posts, platforms, gain24h, opts = {}) {
  const avgMeme = posts.reduce((s, p) => s + (p.memeScore || 0), 0) / Math.max(posts.length, 1);
  const platBonus = Math.min(platforms.length, 4) * 8;
  const countBonus = Math.min(posts.length, 12) * 4;
  const gainBonus = Math.min(gain24h / 50000, 1) * 25;
  const crossBonus = isCrossPlatform(platforms) ? (opts.crossPlatformOrganicBoost ?? 25) : 0;
  const authorBonus = Math.min((opts.authorVelocity ?? 0) / 10, 1) * 30;
  return Math.round(Math.min(100, avgMeme * 45 + platBonus + countBonus + gainBonus + crossBonus + authorBonus));
}

function extractTickers(posts) {
  const byTicker = new Map();

  for (const p of posts) {
    for (const tag of p.cashtags || extractCashtags(p.text)) {
      if (!byTicker.has(tag)) {
        byTicker.set(tag, {
          ticker: tag,
          name: tag.charAt(0) + tag.slice(1).toLowerCase(),
          canonical: false,
          endorsedBy: null,
          memeScore: 0,
        });
      }
    }
    if (p.suggestedTicker) {
      const t = String(p.suggestedTicker).replace(/^\$/, '').toUpperCase();
      const cur = byTicker.get(t) || {
        ticker: t,
        name: p.suggestedName || t,
        canonical: false,
        endorsedBy: null,
        memeScore: 0,
      };
      cur.name = p.suggestedName || cur.name;
      cur.memeScore = Math.max(cur.memeScore, p.memeScore || 0);
      cur.endorsedBy = p.handle || cur.endorsedBy;
      byTicker.set(t, cur);
    }
  }

  const list = [...byTicker.values()].sort((a, b) => b.memeScore - a.memeScore);
  if (list.length) list[0].canonical = true;
  return list;
}

function aggregateMemeScores(posts) {
  if (!posts.length) return { meme_score: 0, max_meme_score: 0 };
  const topByViews = posts.slice().sort((a, b) => b.latestViews - a.latestViews)[0];
  const meme_score = topByViews?.memeScore ?? 0;
  const max_meme_score = posts.reduce((m, p) => Math.max(m, p.memeScore || 0), 0);
  return { meme_score, max_meme_score };
}

function maxNarrativeAgeForPlatforms(platforms, opts = {}) {
  const set = new Set(platforms || []);
  const ttOnly = set.has('tt') && !set.has('x');
  if (ttOnly) return opts.maxNarrativeAgeMinTt ?? (Number(process.env.MAX_NARRATIVE_AGE_MIN_TT) || 4320);
  return opts.maxNarrativeAgeMin ?? (Number(process.env.MAX_NARRATIVE_AGE_MIN) || 720);
}

function deriveGateReason({
  combinedViews,
  memeScore,
  viewsVelocity,
  minDisplayViews,
  memeMin,
  newestPostAgeMin,
  maxNarrativeAgeMin,
  platforms,
  distinctAuthors,
  authorVelocity,
  tickerProposals,
  ctPickup,
  skipVelocityForTt,
  memeBypass,
}) {
  if (
    maxNarrativeAgeMin != null
    && newestPostAgeMin != null
    && newestPostAgeMin > maxNarrativeAgeMin
  ) {
    return 'too_old';
  }
  if (combinedViews < minDisplayViews) return 'below_views';

  const bypassMeme = memeBypass || (tickerProposals != null && tickerProposals >= 3);
  if (!bypassMeme && memeScore < memeMin) return 'low_meme';

  const plats = platforms || [];
  const ttOnly = plats.length === 1 && plats[0] === 'tt';
  const replicationOk = (distinctAuthors != null && distinctAuthors >= 2)
    || (authorVelocity != null && authorVelocity > 0);

  if (ttOnly && (skipVelocityForTt || isTikTokVelocityUnreliable())) {
    if (replicationOk || ctPickup) return 'eligible';
    return 'no_replication';
  }

  if (ttOnly && replicationOk && !(viewsVelocity > 0)) {
    return 'eligible';
  }

  const velocityOk = viewsVelocity > 0
    || (authorVelocity > 0 && distinctAuthors >= 3)
    || (ctPickup && replicationOk);

  if (!velocityOk) return 'no_velocity';
  return 'eligible';
}

function applyDisplayGate(narr, opts = {}) {
  const members = narr.memberPosts || [];
  const platforms = narr.platforms || [...new Set(members.map(p => p.platform || 'x'))];
  const signals = opts.signals || aggregateNarrativeSignals(members);
  const maxAge = maxNarrativeAgeForPlatforms(platforms, opts);
  const newestPostAgeMin = newestPostAgeMinutes(members);
  const memeMin = narr.meme_min ?? memeMinForNarrative(platforms);
  const tickerProposals = signals.ticker_proposals ?? narr.ticker_proposals ?? 0;

  const gate_reason = deriveGateReason({
    combinedViews: narr.combined_views,
    memeScore: narr.meme_score,
    viewsVelocity: narr.views_velocity,
    minDisplayViews: opts.minDisplayViews ?? 0,
    memeMin,
    newestPostAgeMin,
    maxNarrativeAgeMin: maxAge,
    platforms,
    distinctAuthors: narr.distinct_authors ?? 0,
    authorVelocity: narr.author_velocity ?? 0,
    tickerProposals,
    ctPickup: signals.ct_pickup ?? narr.ct_pickup ?? false,
    skipVelocityForTt: opts.skipVelocityForTt ?? isTikTokVelocityUnreliable(),
    memeBypass: tickerProposals >= 3,
  });

  const organic = organicScore(members, platforms, narr.gain_24h ?? 0, {
    crossPlatformOrganicBoost: opts.crossPlatformOrganicBoost,
    authorVelocity: narr.author_velocity ?? 0,
  });

  return {
    ...narr,
    platforms,
    ticker_proposals: tickerProposals,
    ct_pickup: !!signals.ct_pickup,
    gate_reason,
    meme_min: memeMin,
    display_eligible: gate_reason === 'eligible',
    organic_score: organic,
    lead_time_min: gate_reason === 'eligible' ? (narr.lead_time_min ?? narr.age_min) : null,
  };
}

async function deriveNarrative(id, posts, opts = {}) {
  const minDisplayViews = opts.minDisplayViews ?? 0;
  const minEngagementRate = opts.minEngagementRate ?? 0.005;
  const enriched = posts.map(enrichPost);

  const copyOpts = {
    existingTitle: opts.existingTitle,
    existingBlurb: opts.existingBlurb,
    membersAdded: opts.membersAdded || 0,
    clusterMatch: opts.clusterMatch,
    forceTitle: opts.forceTitle,
    regenTitle: opts.regenTitle,
  };

  let title;
  let blurb;
  let titleSource;
  if (shouldRegenNarrativeCopy(enriched, copyOpts)) {
    ({ title, blurb, source: titleSource } = await generateNarrativeCopy(enriched, {
      sb: opts.sb,
      existingTitle: opts.existingTitle,
      existingBlurb: opts.existingBlurb,
    }));
  } else {
    ({ title, blurb, source: titleSource } = cachedNarrativeCopy(enriched, copyOpts));
  }

  if (titleSource === 'claude') {
    console.log(`[cluster] title "${title}" (${titleSource}) for ${id}`);
  }
  const platforms = [...new Set(enriched.map(p => p.platform || 'x'))];
  const cross_platform = isCrossPlatform(platforms);
  const memeMin = opts.memeMin ?? memeMinForNarrative(platforms);
  const series = buildViewSeries(enriched);
  const postViewSum = enriched.reduce((s, p) => s + (p.latestViews || 0), 0);
  const combinedViews = postViewSum || (series.length ? series[series.length - 1] : 0);
  const gain24h = gain24hFromSeries(series);
  let { views_velocity, accel, engagement_velocity } = aggregateViewsMetrics(enriched);
  if (cross_platform && views_velocity > 0) {
    views_velocity = Math.round(views_velocity * (opts.crossPlatformVvMult ?? 1.2));
  }
  const lifecycle = lifecycleFromViewsMetrics(views_velocity, accel);
  const engRate = narrativeEngagementRate(enriched);
  const bought_reach = isBoughtReach(combinedViews, engRate, minEngagementRate);
  const { meme_score, max_meme_score } = aggregateMemeScores(enriched);
  const newestPostAgeMin = newestPostAgeMinutes(enriched);
  const maxNarrativeAgeMin = maxNarrativeAgeForPlatforms(platforms, opts);
  const gate_reason = deriveGateReason({
    combinedViews,
    memeScore: meme_score,
    viewsVelocity: views_velocity,
    minDisplayViews,
    memeMin,
    newestPostAgeMin,
    maxNarrativeAgeMin,
    platforms,
    distinctAuthors: 0,
    authorVelocity: 0,
    tickerProposals: 0,
    ctPickup: false,
    skipVelocityForTt: opts.skipVelocityForTt ?? isTikTokVelocityUnreliable(),
    memeBypass: false,
  });
  const display_eligible = gate_reason === 'eligible';

  const oldest = oldestPostCreatedMs(enriched) ?? Date.now();
  const ageMin = Math.max(1, Math.round((Date.now() - oldest) / 60000));
  const topPost = enriched.slice().sort((a, b) => b.latestViews - a.latestViews)[0];
  const organic = organicScore(enriched, platforms, gain24h, {
    crossPlatformOrganicBoost: opts.crossPlatformOrganicBoost,
  });
  const tickers = extractTickers(enriched);

  return {
    id,
    title,
    blurb,
    img_seed: Math.abs(hashStr(id)) % 14,
    created_at: oldest,
    narr_idx: -1,
    lead_time_min: display_eligible ? ageMin : null,
    organic_score: organic,
    combined_views: combinedViews,
    meme_score,
    max_meme_score,
    gate_reason,
    meme_min: memeMin,
    display_eligible,
    bought_reach,
    views_velocity,
    accel,
    engagement_velocity,
    first_seen_at: new Date(oldest).toISOString(),
    platforms,
    cross_platform,
    gain_24h: gain24h,
    lifecycle,
    age_min: ageMin,
    top_post_id: topPost?.id || null,
    source: 'cluster',
    status: 'open',
    memberPosts: enriched,
    tickers,
    centroid: narrativeCentroid(enriched),
    distinct_authors: 0,
    author_velocity: 0,
    ticker_proposals: 0,
    ct_pickup: false,
  };
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function newNarrativeId(posts) {
  const enriched = posts.map(p => enrichPost(p));
  const top = enriched.slice().sort((a, b) => b.latestViews - a.latestViews)[0] || enriched[0];
  const title = firstClauseTitle(top?.text || '');
  const slug = slugify(title);
  const suffix = Math.abs(hashStr(posts[0]?.id || String(Date.now()))).toString(36).slice(0, 6);
  return `c-${slug}-${suffix}`;
}

module.exports = {
  enrichPost,
  matchPostToNarrative,
  deriveNarrative,
  newNarrativeId,
  latestViews,
  buildViewSeries,
  aggregateViewsMetrics,
  gain24hFromSeries,
  narrativeEngagementRate,
  isBoughtReach,
  aggregateMemeScores,
  deriveGateReason,
  applyDisplayGate,
  maxNarrativeAgeForPlatforms,
};
