'use strict';

const { withRetry } = require('./retry');
const { loadEnvLocal, requireEnv } = require('./env');

function getConfig() {
  loadEnvLocal();
  const base = (process.env.X_API_BASE || 'https://api.twitterapi.io').replace(/\/$/, '');
  const apiKey = requireEnv('X_API_KEY');
  return { base, apiKey };
}

/** Log/debug helper — time window is embedded in query via ingest-query.buildQueries. */
function buildAdvancedSearchUrl(query, queryType = 'Latest', cursor = '') {
  const { base } = getConfig();
  const url = new URL(`${base}/twitter/tweet/advanced_search`);
  url.searchParams.set('query', query);
  url.searchParams.set('queryType', queryType);
  if (cursor) url.searchParams.set('cursor', cursor);
  return url.toString();
}

async function xFetch(path, params = {}, label = 'x-api') {
  const { base, apiKey } = getConfig();
  const url = new URL(path.startsWith('http') ? path : base + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  });

  return withRetry(async () => {
    const r = await fetch(url.toString(), {
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
    });
    if (r.status === 429) {
      const err = new Error('HTTP 429 rate limited');
      err.status = 429;
      throw err;
    }
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status} ${url.pathname}`);
      err.status = r.status;
      throw err;
    }
    return r.json();
  }, { label });
}

/** Advanced search — one page. Time window uses since_time:/until_time: inside query text. */
async function searchTweets(query, queryType = 'Latest', cursor = '') {
  const params = { query, queryType };
  if (cursor) params.cursor = cursor;
  return xFetch('/twitter/tweet/advanced_search', params, `search:${query.slice(0, 40)}`);
}

/** Fetch tweets by ID (comma-separated). */
async function getTweetsByIds(tweetIds) {
  if (!tweetIds.length) return { tweets: [], status: 'success' };
  return xFetch('/twitter/tweets', { tweet_ids: tweetIds.join(',') }, `tweets:${tweetIds.length}`);
}

function tweetsInResponse(data) {
  return Array.isArray(data?.tweets) ? data.tweets.length : 0;
}

module.exports = {
  searchTweets,
  getTweetsByIds,
  getConfig,
  buildAdvancedSearchUrl,
  tweetsInResponse,
};
