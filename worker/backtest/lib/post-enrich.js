'use strict';

const UA = 'Mozilla/5.0 (compatible; InsidorBacktest/1.0)';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function extractTweetId(url) {
  const s = String(url || '');
  const m = s.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/i);
  return m ? m[1] : null;
}

function detectPlatform(url) {
  const u = String(url || '').toLowerCase();
  if (!u) return 'none';
  if (u.includes('x.com/') || u.includes('twitter.com/')) {
    if (extractTweetId(u)) return 'x';
    return 'x_other';
  }
  if (u.includes('tiktok.com') || u.includes('vm.tiktok.com')) return 'tiktok';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('reddit.com')) return 'reddit';
  if (u.includes('youtu.be') || u.includes('youtube.com')) return 'youtube';
  return 'other';
}

function mediaTypeFromSyndication(data) {
  if (data?.video) return 'video';
  if (Array.isArray(data?.photos) && data.photos.length) return 'image';
  if (data?.entities?.media?.length) return 'image';
  return 'text';
}

function mediaTypeFromOfficial(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'photo') return 'image';
  if (t === 'video' || t === 'animated_gif') return 'video';
  if (t) return 'text';
  return 'text';
}

async function fetchSyndication(tweetId) {
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(tweetId)}&lang=en&token=0`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`syndication HTTP ${r.status}`);
  const data = await r.json();
  if (!data?.id_str && !data?.text) throw new Error('syndication empty payload');
  return data;
}

async function fetchOembed(postUrl) {
  const url = `https://publish.twitter.com/oembed?omit_script=1&dnt=1&url=${encodeURIComponent(postUrl)}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`oembed HTTP ${r.status}`);
  const data = await r.json();
  if (!data?.html && !data?.author_name) throw new Error('oembed empty payload');
  return data;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapSyndication(data) {
  return {
    author_handle: data.user?.screen_name ? `@${data.user.screen_name}` : '',
    author_followers: '',
    post_created_at: data.created_at || '',
    media_type: mediaTypeFromSyndication(data),
    views_now: '',
    replies_now: data.conversation_count != null ? String(data.conversation_count) : '',
    reposts_now: '',
    post_text: (data.text || '').trim(),
  };
}

function mapOembed(data, postUrl) {
  const handleMatch = String(data.author_url || postUrl || '').match(/(?:twitter\.com|x\.com)\/([^/?#]+)/i);
  const handle = handleMatch && !['status', 'i', 'search'].includes(handleMatch[1].toLowerCase())
    ? `@${handleMatch[1]}`
    : '';
  return {
    author_handle: handle || (data.author_name ? data.author_name : ''),
    author_followers: '',
    post_created_at: '',
    media_type: /video/i.test(data.html || '') ? 'video' : (/img|photo/i.test(data.html || '') ? 'image' : 'text'),
    views_now: '',
    replies_now: '',
    reposts_now: '',
    post_text: stripHtml(data.html || ''),
  };
}

function mapOfficial(post) {
  return {
    author_handle: post.handle ? `@${post.handle}` : '',
    author_followers: post.followers != null ? String(post.followers) : '',
    post_created_at: post.posted_at ? new Date(post.posted_at).toISOString() : '',
    media_type: mediaTypeFromOfficial(post.media_type),
    views_now: post.views != null ? String(post.views) : '',
    replies_now: post.replies != null ? String(post.replies) : '',
    reposts_now: post.retweets != null ? String(post.retweets) : '',
    post_text: (post.text || '').trim(),
  };
}

async function enrichXPost(postUrl, { getTweetById, delayMs = 400 } = {}) {
  const tweetId = extractTweetId(postUrl);
  if (!tweetId) {
    return { enrich_method: 'skipped', enrich_error: 'not a tweet status URL' };
  }

  await sleep(delayMs);

  try {
    const syn = await fetchSyndication(tweetId);
    return { ...mapSyndication(syn), enrich_method: 'syndication', enrich_error: '' };
  } catch (synErr) {
    await sleep(delayMs);
    try {
      const oem = await fetchOembed(postUrl);
      return {
        ...mapOembed(oem, postUrl),
        enrich_method: 'oembed',
        enrich_error: '',
        enrich_note: `syndication failed: ${synErr.message}`,
      };
    } catch (oemErr) {
      if (!getTweetById) {
        return {
          enrich_method: 'failed',
          enrich_error: `syndication: ${synErr.message}; oembed: ${oemErr.message}; no X_OFFICIAL_BEARER_TOKEN`,
        };
      }
      try {
        const { post } = await getTweetById(tweetId, { stage: 'blind_enrich' });
        return {
          ...mapOfficial(post),
          enrich_method: 'x_official',
          enrich_error: '',
          enrich_note: `syndication: ${synErr.message}; oembed: ${oemErr.message}`,
        };
      } catch (offErr) {
        return {
          enrich_method: 'failed',
          enrich_error: `syndication: ${synErr.message}; oembed: ${oemErr.message}; official: ${offErr.message}`,
        };
      }
    }
  }
}

async function resolveUrl(url) {
  try {
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': UA },
    });
    return r.url || url;
  } catch {
    return url;
  }
}

async function enrichTikTok(postUrl, { delayMs = 400 } = {}) {
  await sleep(delayMs);
  const resolved = await resolveUrl(postUrl);
  try {
    const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(resolved)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`tiktok oembed HTTP ${r.status}`);
    const data = await r.json();
    const handleMatch = String(data.author_url || resolved).match(/tiktok\.com\/@([^/?#]+)/i);
    return {
      author_handle: handleMatch ? `@${handleMatch[1]}` : (data.author_name || ''),
      author_followers: '',
      post_created_at: '',
      media_type: data.type === 'video' ? 'video' : 'text',
      views_now: '',
      replies_now: '',
      reposts_now: '',
      post_text: (data.title || '').trim(),
      enrich_method: 'tiktok_oembed',
      enrich_error: '',
    };
  } catch (err) {
    return { enrich_method: 'failed', enrich_error: err.message };
  }
}

async function enrichYouTube(postUrl, { delayMs = 400 } = {}) {
  await sleep(delayMs);
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(postUrl)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`youtube oembed HTTP ${r.status}`);
    const data = await r.json();
    return {
      author_handle: data.author_name || '',
      author_followers: '',
      post_created_at: '',
      media_type: data.type === 'video' ? 'video' : 'text',
      views_now: '',
      replies_now: '',
      reposts_now: '',
      post_text: (data.title || '').trim(),
      enrich_method: 'youtube_oembed',
      enrich_error: '',
    };
  } catch (err) {
    return { enrich_method: 'failed', enrich_error: err.message };
  }
}

async function enrichInstagram(postUrl, { delayMs = 400 } = {}) {
  await sleep(delayMs);
  try {
    const r = await fetch(`https://api.instagram.com/oembed?omitscript=true&url=${encodeURIComponent(postUrl)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`instagram oembed HTTP ${r.status}`);
    const data = await r.json();
    return {
      author_handle: data.author_name || '',
      author_followers: '',
      post_created_at: '',
      media_type: 'image',
      views_now: '',
      replies_now: '',
      reposts_now: '',
      post_text: (data.title || '').trim(),
      enrich_method: 'instagram_oembed',
      enrich_error: '',
    };
  } catch (err) {
    return { enrich_method: 'failed', enrich_error: err.message };
  }
}

async function enrichReddit(postUrl, { delayMs = 400 } = {}) {
  await sleep(delayMs);
  const normalized = String(postUrl).replace('www.reddit.com', 'old.reddit.com').replace(/\/$/, '');
  const jsonUrl = normalized.includes('.json') ? normalized : `${normalized}.json`;
  try {
    const r = await fetch(jsonUrl, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`reddit json HTTP ${r.status}`);
    const data = await r.json();
    const post = data?.[0]?.data?.children?.[0]?.data;
    if (!post) throw new Error('reddit post not found in listing');
    return {
      author_handle: post.author ? `u/${post.author}` : '',
      author_followers: '',
      post_created_at: post.created_utc
        ? new Date(post.created_utc * 1000).toISOString()
        : '',
      media_type: post.is_video ? 'video' : (post.post_hint === 'image' ? 'image' : 'text'),
      views_now: '',
      replies_now: post.num_comments != null ? String(post.num_comments) : '',
      reposts_now: '',
      post_text: (post.title || '').trim(),
      enrich_method: 'reddit_json',
      enrich_error: '',
    };
  } catch (err) {
    return { enrich_method: 'failed', enrich_error: err.message };
  }
}

function computeHoursPostToLaunch(coinCreatedAt, postCreatedAt) {
  const coinMs = Date.parse(coinCreatedAt);
  const postMs = Date.parse(postCreatedAt);
  if (!Number.isFinite(coinMs) || !Number.isFinite(postMs)) return '';
  const hours = (coinMs - postMs) / 3_600_000;
  return Number.isFinite(hours) ? hours.toFixed(2) : '';
}

module.exports = {
  detectPlatform,
  extractTweetId,
  enrichXPost,
  enrichTikTok,
  enrichYouTube,
  enrichInstagram,
  enrichReddit,
  computeHoursPostToLaunch,
};
