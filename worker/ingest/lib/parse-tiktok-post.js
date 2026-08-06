'use strict';

const { normalizePostedAt } = require('../../lib/posted-at');

/*
 * Apify TikTok actors (hashtag / discover / video scrapers) → narrative_posts shape.
 * Field mapping:
 *   playCount → views, diggCount → likes, shareCount → retweets (reposts),
 *   commentCount → replies, createTimeISO → posted_at,
 *   author.uniqueId → handle, covers.default → media_url, webVideoUrl in raw.
 */

function parseIsoMs(str) {
  if (!str) return null;
  const ms = Date.parse(str);
  return Number.isFinite(ms) ? ms : null;
}

function parseCreateTime(raw) {
  if (raw?.createTimeISO) return normalizePostedAt(parseIsoMs(raw.createTimeISO));
  if (raw?.createTime != null) return normalizePostedAt(Number(raw.createTime));
  return null;
}

function authorFromRaw(raw) {
  const author = raw?.author || raw?.authorMeta || {};
  const uniqueId = author.uniqueId || author.name || author.nickName || 'unknown';
  const handle = uniqueId.startsWith('@') ? uniqueId : `@${uniqueId}`;
  return {
    handle,
    followers: author.fans ?? author.followerCount ?? author.followers ?? null,
  };
}

function coverFromRaw(raw) {
  const covers = raw?.covers || {};
  return covers.default
    || covers.origin
    || raw?.videoMeta?.coverUrl
    || raw?.videoMeta?.originalCoverUrl
    || null;
}

function videoUrlFromRaw(raw, handle, videoId) {
  if (raw?.webVideoUrl) return raw.webVideoUrl;
  const h = (handle || '@user').replace(/^@/, '');
  if (videoId) return `https://www.tiktok.com/@${h}/video/${videoId}`;
  return null;
}

function soundIdFromRaw(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.musicMeta?.musicId
    || raw.music?.id
    || raw.music?.musicId
    || raw.meta?.music?.id
    || raw.soundId
    || raw.musicId;
  return id != null ? String(id) : null;
}

/** Map one Apify TikTok item → canonical parsed post (same shape as parseRawPost). */
function parseTikTokPost(raw) {
  const videoId = String(raw?.id || raw?.videoId || raw?.aweme_id || '');
  if (!videoId) throw new Error('parseTikTokPost: missing video id');

  const { handle, followers } = authorFromRaw(raw);
  const cover = coverFromRaw(raw);
  const webVideoUrl = videoUrlFromRaw(raw, handle, videoId);
  const soundId = soundIdFromRaw(raw);

  return {
    platform: 'tt',
    platformPostId: videoId,
    handle,
    text: raw.text || raw.desc || raw.description || '',
    followers,
    image: !!cover,
    mediaUrl: cover,
    mediaType: 'video',
    soundId,
    views: Number(raw.playCount ?? raw.stats?.playCount ?? 0) || 0,
    replies: Number(raw.commentCount ?? raw.stats?.commentCount ?? 0) || 0,
    quotes: 0,
    likes: Number(raw.diggCount ?? raw.stats?.diggCount ?? 0) || 0,
    retweets: Number(raw.shareCount ?? raw.stats?.shareCount ?? 0) || 0,
    bookmarks: Number(raw.collectCount ?? raw.stats?.collectCount ?? null) || null,
    postedAt: parseCreateTime(raw),
    notable: false,
    sampleReplies: [],
    raw: { ...raw, webVideoUrl: webVideoUrl || raw.webVideoUrl || null },
  };
}

/** Engagement metrics for post_snapshots from Apify TikTok raw payload. */
function engagementFromTikTokRaw(raw) {
  if (!raw) {
    return {
      views: null,
      replies: null,
      quotes: null,
      likes: null,
      retweets: null,
      bookmarks: null,
      unavailable: true,
      raw: null,
    };
  }

  return {
    views: Number(raw.playCount ?? raw.stats?.playCount ?? null) || null,
    replies: Number(raw.commentCount ?? raw.stats?.commentCount ?? null) || null,
    quotes: null,
    likes: Number(raw.diggCount ?? raw.stats?.diggCount ?? null) || null,
    retweets: Number(raw.shareCount ?? raw.stats?.shareCount ?? null) || null,
    bookmarks: Number(raw.collectCount ?? raw.stats?.collectCount ?? null) || null,
    unavailable: false,
    raw,
  };
}

function tiktokVideoUrl(post) {
  const raw = post?.raw || {};
  if (raw.webVideoUrl) return raw.webVideoUrl;
  const h = (post.handle || '@user').replace(/^@/, '');
  const id = post.platform_post_id || post.platformPostId;
  if (id) return `https://www.tiktok.com/@${h}/video/${id}`;
  return null;
}

module.exports = {
  parseTikTokPost,
  engagementFromTikTokRaw,
  tiktokVideoUrl,
  coverFromRaw,
  soundIdFromRaw,
};
