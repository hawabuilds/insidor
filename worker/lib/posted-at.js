'use strict';

/**
 * Post age helpers — canonical column: narrative_posts.posted_at (bigint, unix ms).
 * normalizePostedAt() detects legacy seconds (value < 1e12) and converts to ms.
 */

function normalizePostedAt(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) return normalizePostedAt(Number(trimmed));
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? ms : null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

function postCreatedMs(post) {
  if (!post) return null;
  if (post.postedAt != null) return normalizePostedAt(post.postedAt);
  if (post.posted_at != null) return normalizePostedAt(post.posted_at);
  return null;
}

function postAgeMinutes(post, nowMs = Date.now()) {
  const created = postCreatedMs(post);
  if (created == null) return null;
  return Math.max(0, (nowMs - created) / 60000);
}

function isPostWithinMaxAge(post, maxAgeMin, nowMs = Date.now()) {
  if (maxAgeMin == null || maxAgeMin <= 0) return true;
  const created = postCreatedMs(post);
  if (created == null) return false;
  return created > nowMs - maxAgeMin * 60 * 1000;
}

function oldestPostCreatedMs(posts) {
  return (posts || []).reduce((min, p) => {
    const t = postCreatedMs(p);
    if (t == null) return min;
    return min == null ? t : Math.min(min, t);
  }, null);
}

function newestPostCreatedMs(posts) {
  return (posts || []).reduce((max, p) => {
    const t = postCreatedMs(p);
    if (t == null) return max;
    return max == null ? t : Math.max(max, t);
  }, null);
}

function newestPostAgeMinutes(posts, nowMs = Date.now()) {
  const newest = newestPostCreatedMs(posts);
  if (newest == null) return null;
  return Math.max(0, (nowMs - newest) / 60000);
}

/** Track age-at-ingest for cycle median logging. */
function trackIngestAge(stats, parsed, nowMs = Date.now()) {
  const ms = postCreatedMs(parsed);
  if (ms == null) return;
  if (!stats.ingestAgesMin) stats.ingestAgesMin = [];
  stats.ingestAgesMin.push(Math.max(0, (nowMs - ms) / 60000));
}

function medianIngestAgeMin(stats) {
  const ages = stats?.ingestAgesMin;
  if (!ages?.length) return null;
  const sorted = ages.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatRecencyLog(stats, platform) {
  const fetched = stats.returned || 0;
  const stale = stats.droppedStale || 0;
  const ingested = stats.ingested || 0;
  const med = medianIngestAgeMin(stats);
  const medStr = med != null ? `${med.toFixed(0)}m` : 'n/a';
  return (
    `[${platform}] fetched=${fetched} dropped_stale=${stale} ingested=${ingested} ` +
    `median_age_at_ingest=${medStr}`
  );
}

module.exports = {
  normalizePostedAt,
  postCreatedMs,
  postAgeMinutes,
  isPostWithinMaxAge,
  oldestPostCreatedMs,
  newestPostCreatedMs,
  newestPostAgeMinutes,
  trackIngestAge,
  medianIngestAgeMin,
  formatRecencyLog,
};
