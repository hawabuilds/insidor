'use strict';

const { engagementFromRaw } = require('./parse-raw-post');

async function insertPostSnapshot(sb, postId, engagement) {
  const row = {
    post_id: postId,
    captured_at: new Date().toISOString(),
    views: engagement.views,
    replies: engagement.replies,
    quotes: engagement.quotes,
    likes: engagement.likes,
    retweets: engagement.retweets,
    bookmarks: engagement.bookmarks,
    unavailable: !!engagement.unavailable,
    raw: engagement.raw,
  };

  const { error } = await sb.from('post_snapshots').insert(row);
  if (error) throw new Error('post_snapshots insert: ' + error.message);
}

function engagementFromParsed(parsed) {
  if (parsed?.platform === 'tt') {
    const { engagementFromTikTokRaw } = require('./parse-tiktok-post');
    return engagementFromTikTokRaw(parsed.raw);
  }
  return engagementFromRaw(parsed.raw);
}

module.exports = { insertPostSnapshot, engagementFromParsed, engagementFromRaw };
