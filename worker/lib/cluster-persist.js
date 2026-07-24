'use strict';

const { embedText } = require('./embeddings');
const { extractSubjectEntity } = require('./subject-entity');
const { scanPostSignals } = require('./ticker-proposals');
const { maxNarrativeAgeForPlatforms } = require('./cluster-engine');
const { newestPostAgeMinutes } = require('./posted-at');

function fin(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function finNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanText(s, maxLen) {
  let t = String(s ?? '');
  t = t.replace(/[\uD800-\uDFFF]/g, '');
  t = t.replace(/\u0000/g, '');
  return t.slice(0, maxLen);
}

async function ensureEmbedding(sb, postId, text) {
  const { data: existing } = await sb
    .from('post_embeddings')
    .select('post_id')
    .eq('post_id', postId)
    .maybeSingle();

  if (existing) return;

  const embedding = embedText(text);
  const { error } = await sb.from('post_embeddings').upsert({
    post_id: postId,
    embedding,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error('post_embeddings: ' + error.message);
}

async function upsertNarrative(sb, narr) {
  let lead_time_min = narr.lead_time_min;
  if (narr.display_eligible) {
    const { data: existing } = await sb
      .from('narratives')
      .select('lead_time_min')
      .eq('id', narr.id)
      .maybeSingle();
    if (existing?.lead_time_min != null && existing.lead_time_min > 0) {
      lead_time_min = existing.lead_time_min;
    } else if (lead_time_min == null && narr.age_min) {
      lead_time_min = narr.age_min;
    }
  }

  const row = {
    id: narr.id,
    title: cleanText(narr.title, 80),
    blurb: cleanText(narr.blurb, 160),
    img_seed: fin(narr.img_seed, 0),
    created_at: fin(narr.created_at, Date.now()),
    narr_idx: fin(narr.narr_idx, -1),
    lead_time_min: lead_time_min != null ? fin(lead_time_min) : null,
    organic_score: fin(narr.organic_score),
    source: 'cluster',
    status: narr.status || 'open',
    combined_views: fin(narr.combined_views),
    meme_score: finNull(narr.meme_score),
    max_meme_score: finNull(narr.max_meme_score),
    gate_reason: narr.gate_reason ?? null,
    display_eligible: !!narr.display_eligible,
    bought_reach: !!narr.bought_reach,
    views_velocity: fin(narr.views_velocity),
    accel: fin(narr.accel),
    engagement_velocity: finNull(narr.engagement_velocity),
    first_seen_at: narr.first_seen_at || null,
    platforms: Array.isArray(narr.platforms) ? narr.platforms : [],
    cross_platform: !!narr.cross_platform,
    gain_24h: fin(narr.gain_24h),
    lifecycle: narr.lifecycle || 'peaking',
    age_min: fin(narr.age_min, 1),
    top_post_id: narr.top_post_id || null,
    updated_at: new Date().toISOString(),
    distinct_authors: fin(narr.distinct_authors),
    author_velocity: fin(narr.author_velocity),
    ticker_proposals: fin(narr.ticker_proposals),
    ct_pickup: !!narr.ct_pickup,
  };

  const { error } = await sb.from('narratives').upsert(row, { onConflict: 'id' });
  if (error) {
    throw new Error(`narratives upsert (${narr.id}): ${error.message}${error.details ? ` — ${error.details}` : ''}`);
  }
}

async function assignPosts(sb, narrativeId, posts) {
  const byId = new Map();
  for (const p of posts || []) {
    if (p?.id) byId.set(p.id, p);
  }
  const sorted = [...byId.values()].sort(
    (a, b) => (b.latestViews ?? b.views ?? 0) - (a.latestViews ?? a.views ?? 0),
  );

  const latestSnap = (p) => {
    const snaps = (p.post_snapshots || [])
      .filter(s => !s.unavailable)
      .sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
    return snaps[0] || null;
  };

  // Two-phase sort_order to avoid (narrative_id, sort_order) unique collisions.
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const { error } = await sb
      .from('narrative_posts')
      .update({ narrative_id: narrativeId, sort_order: 100000 + i })
      .eq('id', p.id);
    if (error) throw new Error(`assign post temp ${p.id}: ${error.message}`);
  }

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const snap = latestSnap(p);
    const signals = scanPostSignals(p);
    const subjectEntity = extractSubjectEntity(p);
    const { error } = await sb
      .from('narrative_posts')
      .update({
        narrative_id: narrativeId,
        sort_order: i,
        cluster_match: p.cluster_match || null,
        views: p.latestViews ?? snap?.views ?? p.views ?? 0,
        replies: snap?.replies ?? p.replies ?? 0,
        quotes: snap?.quotes ?? p.quotes ?? 0,
        likes: snap?.likes ?? p.likes ?? 0,
        retweets: snap?.retweets ?? p.retweets ?? 0,
        subject_entity: subjectEntity,
        ct_pickup: signals.ct_pickup,
        ticker_proposal_count: signals.ticker_proposal_count,
      })
      .eq('id', p.id);

    if (error) throw new Error(`assign post ${p.id}: ${error.message}`);
    await ensureEmbedding(sb, p.id, p.text);
  }
}

async function upsertTickers(sb, narrativeId, tickers) {
  await sb.from('narrative_tickers').delete().eq('narrative_id', narrativeId);

  if (!tickers.length) return;

  const rows = tickers.map(t => ({
    narrative_id: narrativeId,
    ticker: t.ticker,
    name: t.name,
    mcap: 0,
    liquidity: 0,
    vol24h: 0,
    holders: 0,
    age_min: 0,
    first_deployed: false,
    endorsed_by: t.endorsedBy,
    canonical: !!t.canonical,
  }));

  const { error } = await sb.from('narrative_tickers').upsert(rows, { onConflict: 'narrative_id,ticker' });
  if (error) throw new Error('narrative_tickers: ' + error.message);
}

async function closeAgedOutNarratives(sb, narratives, opts = {}) {
  const closedIds = [];
  const nowIso = new Date().toISOString();

  for (const narr of narratives || []) {
    const members = narr.memberPosts || [];
    if (!members.length) continue;

    const platforms = [...new Set(members.map(p => p.platform || 'x'))];
    const maxAge = maxNarrativeAgeForPlatforms(platforms, opts);
    const newestAge = newestPostAgeMinutes(members);
    if (newestAge == null || newestAge <= maxAge) continue;

    const { error } = await sb
      .from('narratives')
      .update({
        status: 'closed',
        display_eligible: false,
        gate_reason: 'too_old',
        updated_at: nowIso,
      })
      .eq('id', narr.id)
      .eq('status', 'open');

    if (error) {
      console.warn(`[cluster] close aged ${narr.id}:`, error.message);
      continue;
    }
    closedIds.push(narr.id);
  }

  return closedIds;
}

async function closeEmptyNarratives(sb) {
  const { data: open, error } = await sb
    .from('narratives')
    .select('id, narrative_posts!narrative_posts_narrative_id_fkey(id)')
    .eq('source', 'cluster')
    .eq('status', 'open');

  if (error) throw new Error('close empty select: ' + error.message);

  const emptyIds = (open || [])
    .filter(n => !n.narrative_posts || n.narrative_posts.length === 0)
    .map(n => n.id);

  if (!emptyIds.length) return 0;

  const { error: upErr } = await sb
    .from('narratives')
    .update({ status: 'closed' })
    .in('id', emptyIds);

  if (upErr) throw new Error('close empty: ' + upErr.message);
  return emptyIds.length;
}

module.exports = {
  upsertNarrative,
  assignPosts,
  upsertTickers,
  closeEmptyNarratives,
  closeAgedOutNarratives,
  ensureEmbedding,
};
