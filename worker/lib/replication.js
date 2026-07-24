'use strict';

const { searchTweets } = require('./x-reader');
const { normalizeHandle } = require('./text-utils');
const { buildEntitySearchQuery, extractSubjectEntity } = require('./subject-entity');

const REPLICATION_WINDOW_MIN = Number(process.env.REPLICATION_WINDOW_MIN) || 120;
const X_ENTITY_SEARCH_MAX_PAGES = Number(process.env.X_ENTITY_SEARCH_MAX_PAGES) || 2;

function parseFirstSeenMs(post) {
  const v = post?.first_seen_at || post?.firstSeenAt;
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

function memberDistinctAuthors(posts) {
  const set = new Set();
  for (const p of posts || []) {
    const h = normalizeHandle(p.handle);
    if (h) set.add(h);
  }
  return set.size;
}

/** New distinct authors per hour from member first_seen_at spread. */
function memberAuthorVelocity(posts, nowMs = Date.now()) {
  const windowMs = 60 * 60 * 1000;
  const cutoff = nowMs - windowMs;
  const seenBefore = new Set();
  const seenInHour = new Set();

  const sorted = (posts || [])
    .map(p => ({ h: normalizeHandle(p.handle), t: parseFirstSeenMs(p) }))
    .filter(x => x.h && x.t != null)
    .sort((a, b) => a.t - b.t);

  for (const { h, t } of sorted) {
    if (t < cutoff) seenBefore.add(h);
  }
  for (const { h, t } of sorted) {
    if (t >= cutoff && !seenBefore.has(h)) seenInHour.add(h);
  }

  return seenInHour.size;
}

async function countXDistinctAuthors(entity, opts = {}) {
  const query = buildEntitySearchQuery(entity, REPLICATION_WINDOW_MIN);
  if (!query) return { distinct: 0, authorVelocity: 0, searched: false };

  const handles = new Set();
  let cursor = '';
  const maxPages = opts.maxPages ?? X_ENTITY_SEARCH_MAX_PAGES;

  for (let page = 0; page < maxPages; page += 1) {
    const data = await searchTweets(query, 'Latest', cursor);
    const tweets = data?.tweets || data?.data || [];
    for (const tw of tweets) {
      const h = normalizeHandle(tw.author?.userName || tw.author?.username || tw.user?.screen_name);
      if (h) handles.add(h);
    }
    cursor = data?.next_cursor || data?.cursor || '';
    if (!cursor || !tweets.length) break;
  }

  const hours = REPLICATION_WINDOW_MIN / 60;
  return {
    distinct: handles.size,
    authorVelocity: hours > 0 ? handles.size / hours : handles.size,
    searched: true,
  };
}

async function countTikTokSoundAuthors(sb, soundId) {
  if (!soundId || !sb) return { distinct: 0, authorVelocity: 0 };

  const sinceIso = new Date(Date.now() - REPLICATION_WINDOW_MIN * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from('narrative_posts')
    .select('handle')
    .eq('platform', 'tt')
    .eq('sound_id', String(soundId))
    .gte('first_seen_at', sinceIso);

  if (error) {
    console.warn('[replication] tt sound count:', error.message);
    return { distinct: 0, authorVelocity: 0 };
  }

  const set = new Set();
  for (const row of data || []) {
    const h = normalizeHandle(row.handle);
    if (h) set.add(h);
  }

  const hours = REPLICATION_WINDOW_MIN / 60;
  return {
    distinct: set.size,
    authorVelocity: hours > 0 ? set.size / hours : set.size,
  };
}

function soundIdFromPost(post) {
  return post?.sound_id
    || post?.soundId
    || post?.raw?.musicMeta?.musicId
    || post?.raw?.music?.id
    || post?.raw?.music?.musicId
    || null;
}

/**
 * Compute replication metrics for a narrative cluster.
 * X: optional entity search. TikTok: sound_id creator count.
 */
async function computeNarrativeReplication(sb, posts, opts = {}) {
  const enriched = posts || [];
  const platforms = [...new Set(enriched.map(p => p.platform || 'x'))];

  let distinct = memberDistinctAuthors(enriched);
  let authorVelocity = memberAuthorVelocity(enriched);

  const entity = opts.entity || extractSubjectEntity(
    enriched.slice().sort((a, b) => (b.latestViews || b.views || 0) - (a.latestViews || a.views || 0))[0],
  );

  if (platforms.includes('x') && entity && opts.runXSearch !== false) {
    try {
      const xRep = await countXDistinctAuthors(entity, opts);
      if (xRep.searched) {
        distinct = Math.max(distinct, xRep.distinct);
        authorVelocity = Math.max(authorVelocity, xRep.authorVelocity);
      }
    } catch (e) {
      console.warn(`[replication] X entity search "${entity}":`, e.message);
    }
  }

  if (platforms.includes('tt')) {
    const soundIds = [...new Set(enriched.map(soundIdFromPost).filter(Boolean))];
    for (const sid of soundIds) {
      const ttRep = await countTikTokSoundAuthors(sb, sid);
      distinct = Math.max(distinct, ttRep.distinct);
      authorVelocity = Math.max(authorVelocity, ttRep.authorVelocity);
    }
  }

  return {
    distinct_authors: distinct,
    author_velocity: Math.round(authorVelocity * 100) / 100,
    subject_entity: entity,
  };
}

module.exports = {
  REPLICATION_WINDOW_MIN,
  memberDistinctAuthors,
  memberAuthorVelocity,
  countXDistinctAuthors,
  countTikTokSoundAuthors,
  computeNarrativeReplication,
  soundIdFromPost,
  extractSubjectEntity,
};
