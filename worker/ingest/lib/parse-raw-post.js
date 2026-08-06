'use strict';

const { normalizePostedAt } = require('../../lib/posted-at');

/*
 * PROVIDER_NOTES — twitterapi.io (X_API_BASE default https://api.twitterapi.io)
 *
 * Search:  GET /twitter/tweet/advanced_search?query=&queryType=Latest|Top&cursor=
 * Time:    since_time:<unix_sec> until_time:<unix_sec> inside query (not since:YYYY-MM-DD)
 * By ID:   GET /twitter/tweets?tweet_ids=id1,id2,...
 * Auth:    header X-API-Key: <X_API_KEY>
 *
 * Tweet object fields used here:
 *   id, text, createdAt, viewCount, replyCount, quoteCount, likeCount,
 *   retweetCount, bookmarkCount, author.userName, author.followers, entities
 *
 * If switching readers (official X API, Apify, etc.), rewrite parseRawPost()
 * and engagementFromRaw() only — keep the returned shape stable for ingest/snapshotter.
 */

function parseTwitterCreatedAt(str) {
  if (!str) return null;
  const ms = Date.parse(str);
  return Number.isFinite(ms) ? ms : null;
}

function hasMedia(raw) {
  const ents = raw?.entities || {};
  if (Array.isArray(ents.urls) && ents.urls.some(u => /pic\.twitter\.com|video\.twitter/i.test(u.expanded_url || u.url || ''))) {
    return true;
  }
  return !!(raw?.extendedEntities?.media?.length || raw?.media?.length);
}

/** Photo URL or video/gif poster frame from tweet raw payload. */
function mediaFromRaw(raw) {
  const list = raw?.extendedEntities?.media || raw?.media || [];
  if (!Array.isArray(list) || !list.length) return { mediaUrl: null, mediaType: null };
  const item = list[0];
  const type = item.type || 'photo';
  if (type === 'photo') {
    return {
      mediaUrl: item.media_url_https || item.media_url || null,
      mediaType: 'photo',
    };
  }
  const thumb = item.media_url_https
    || item.preview_image_url
    || (item.video_info?.variants || []).find(v => String(v.content_type || '').startsWith('image/'))?.url
    || null;
  return {
    mediaUrl: thumb,
    mediaType: type === 'animated_gif' ? 'gif' : 'video',
  };
}

/** Map one provider tweet object → narrative_posts row fields + engagement. */
function parseRawPost(raw) {
  if (!raw || !raw.id) {
    throw new Error('parseRawPost: missing tweet id');
  }

  const author = raw.author || {};
  const userName = author.userName || author.screen_name || 'unknown';
  const handle = userName.startsWith('@') ? userName : '@' + userName;

  const { mediaUrl, mediaType } = mediaFromRaw(raw);

  return {
    platform: 'x',
    platformPostId: String(raw.id),
    handle,
    text: raw.text || '',
    followers: author.followers ?? null,
    image: hasMedia(raw),
    mediaUrl,
    mediaType,
    views: raw.viewCount ?? 0,
    replies: raw.replyCount ?? 0,
    quotes: raw.quoteCount ?? 0,
    likes: raw.likeCount ?? 0,
    retweets: raw.retweetCount ?? 0,
    bookmarks: raw.bookmarkCount ?? null,
    postedAt: normalizePostedAt(parseTwitterCreatedAt(raw.createdAt)),
    notable: false,
    sampleReplies: [],
    raw,
  };
}

/** Engagement metrics for post_snapshots — null fields when post unavailable. */
function engagementFromRaw(raw) {
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
    views: raw.viewCount ?? null,
    replies: raw.replyCount ?? null,
    quotes: raw.quoteCount ?? null,
    likes: raw.likeCount ?? null,
    retweets: raw.retweetCount ?? null,
    bookmarks: raw.bookmarkCount ?? null,
    unavailable: false,
    raw,
  };
}

module.exports = { parseRawPost, engagementFromRaw, parseTwitterCreatedAt, mediaFromRaw };
