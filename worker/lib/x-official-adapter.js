'use strict';

/**
 * X API v2 official adapter — BACKTEST ONLY.
 *
 * ~33× the per-read cost of TwitterAPI.io ($0.005/post vs ~$0.00015/tweet).
 * MUST NEVER be wired into ingest.js, snapshotter.js, replication.js, near-miss.js
 * or any Vercel cron route. Standalone backtest scripts only.
 *
 * Auth: OAuth 2.0 app-only bearer token (X Developer Console).
 * Env:  X_OFFICIAL_BEARER_TOKEN (required when used)
 *       X_OFFICIAL_CREDIT_BUDGET (default 10.00 USD)
 *       X_OFFICIAL_COST_PER_READ (default 0.005 USD)
 */

const fs = require('fs');
const path = require('path');
const { loadEnvLocal, requireEnv } = require('./env');

loadEnvLocal();

const COST_PER_READ = Number(process.env.X_OFFICIAL_COST_PER_READ) || 0.005;
const CREDIT_BUDGET = Number(process.env.X_OFFICIAL_CREDIT_BUDGET) || 10.0;
const MAX_RESULTS = Math.min(15, Math.max(10, Number(process.env.X_OFFICIAL_MAX_RESULTS) || 15));

const CHARGE_CACHE_PATH = path.join(__dirname, '..', '..', '.backtest', 'x-official-charged.json');

/** @type {{ utcDate: string, postIds: Set<string>, totalReads: number, totalCost: number }} */
let session = {
  utcDate: utcDateStr(),
  postIds: new Set(),
  totalReads: 0,
  totalCost: 0,
};

function utcDateStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function loadChargeCache() {
  try {
    if (!fs.existsSync(CHARGE_CACHE_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(CHARGE_CACHE_PATH, 'utf8'));
    const today = utcDateStr();
    if (raw.utcDate !== today) return;
    session.utcDate = raw.utcDate;
    session.postIds = new Set(raw.postIds || []);
    session.totalReads = Number(raw.totalReads) || 0;
    session.totalCost = Number(raw.totalCost) || 0;
  } catch (_) { /* fresh session */ }
}

function saveChargeCache() {
  const dir = path.dirname(CHARGE_CACHE_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CHARGE_CACHE_PATH, JSON.stringify({
    utcDate: session.utcDate,
    postIds: [...session.postIds],
    totalReads: session.totalReads,
    totalCost: session.totalCost,
  }, null, 2));
}

function rollUtcDayIfNeeded() {
  const today = utcDateStr();
  if (session.utcDate !== today) {
    session.utcDate = today;
    session.postIds = new Set();
    session.totalReads = 0;
    session.totalCost = 0;
  }
}

loadChargeCache();

function getBearerToken() {
  return requireEnv('X_OFFICIAL_BEARER_TOKEN');
}

function spendSummary() {
  rollUtcDayIfNeeded();
  return {
    reads: session.totalReads,
    cost: session.totalCost,
    budget: CREDIT_BUDGET,
    remaining: Math.max(0, CREDIT_BUDGET - session.totalCost),
  };
}

function logSpendLine(stage, newReads, newCost) {
  const s = spendSummary();
  console.log(
    `backtest · ${newReads} reads · $${newCost.toFixed(3)} · ` +
    `total $${s.cost.toFixed(2)}/$${s.budget.toFixed(2)}` +
    (stage ? ` · ${stage}` : ''),
  );
}

/**
 * Charge unique post IDs once per UTC day. Returns billable count after dedup.
 */
function chargePostIds(postIds) {
  rollUtcDayIfNeeded();
  let billable = 0;
  for (const id of postIds) {
    if (!id || session.postIds.has(id)) continue;
    session.postIds.add(id);
    billable += 1;
  }
  if (billable > 0) {
    session.totalReads += billable;
    session.totalCost += billable * COST_PER_READ;
    saveChargeCache();
  }
  return billable;
}

function assertCanSpend(projectedReads, { stage = 'backtest' } = {}) {
  rollUtcDayIfNeeded();
  const projected = session.totalCost + projectedReads * COST_PER_READ;
  if (projected > CREDIT_BUDGET) {
    throw new Error(
      `X official credit budget exceeded: projected $${projected.toFixed(3)} > ` +
      `$${CREDIT_BUDGET.toFixed(2)} (X_OFFICIAL_CREDIT_BUDGET). ` +
      `${session.totalReads} reads already charged today.`,
    );
  }
  const remaining = CREDIT_BUDGET - session.totalCost;
  console.log(
    `[x-official] ${stage} · est ${projectedReads} reads (~$${(projectedReads * COST_PER_READ).toFixed(3)}) · ` +
    `remaining $${remaining.toFixed(2)}/$${CREDIT_BUDGET.toFixed(2)}`,
  );
}

function toIsoUtc(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Normalise X API v2 tweet + includes → shape backtest feature code expects.
 */
function normalizeOfficialPost(tweet, includes = {}) {
  const users = new Map((includes.users || []).map(u => [u.id, u]));
  const mediaMap = new Map((includes.media || []).map(m => [m.media_key, m]));
  const author = users.get(tweet.author_id);
  let mediaUrl = null;
  let mediaType = null;
  const keys = tweet.attachments?.media_keys || [];
  if (keys.length) {
    const m = mediaMap.get(keys[0]);
    mediaType = m?.type || null;
    mediaUrl = m?.preview_image_url || m?.url || null;
  }
  const pm = tweet.public_metrics || {};
  const postedMs = Date.parse(tweet.created_at);
  return {
    platform_post_id: tweet.id,
    text: tweet.text || '',
    posted_at: Number.isFinite(postedMs) ? postedMs : null,
    handle: author?.username || null,
    followers: author?.public_metrics?.followers_count ?? null,
    views: pm.impression_count ?? null,
    likes: pm.like_count ?? 0,
    replies: pm.reply_count ?? 0,
    retweets: pm.retweet_count ?? 0,
    quotes: pm.quote_count ?? 0,
    media_url: mediaUrl,
    media_type: mediaType,
    raw: tweet,
    _includes: includes,
  };
}

/**
 * GET /2/users/by/username/:username — user lookup (backtest enrichment).
 */
async function getUserByUsername(username, { stage = 'user_lookup' } = {}) {
  const handle = String(username || '').replace(/^@/, '').trim();
  if (!handle) throw new Error('username required');
  assertCanSpend(1, { stage });

  const token = getBearerToken();
  const params = new URLSearchParams({
    'user.fields': 'public_metrics,username',
  });
  const url = `https://api.twitter.com/2/users/by/username/${encodeURIComponent(handle)}?${params}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  const raw = await r.json();
  if (!r.ok) {
    const err = new Error(`X official HTTP ${r.status}: ${raw?.detail || raw?.title || r.statusText}`);
    err.status = r.status;
    err.raw = raw;
    throw err;
  }

  const user = raw.data;
  if (!user) {
    const err = new Error('X official: user not found');
    err.status = 404;
    err.raw = raw;
    throw err;
  }

  const billable = chargePostIds([`user:${handle.toLowerCase()}`]);
  const newCost = billable * COST_PER_READ;
  logSpendLine(stage, billable, newCost);

  return {
    username: user.username,
    followers: user.public_metrics?.followers_count ?? null,
    raw,
    billableReads: billable,
    totalReads: session.totalReads,
    totalCost: session.totalCost,
  };
}

/**
 * GET /2/tweets/:id — single tweet lookup (backtest enrichment).
 * @returns {{ post: object, billableReads: number }}
 */
async function getTweetById(id, { stage = 'tweet_lookup' } = {}) {
  if (!id) throw new Error('tweet id required');
  assertCanSpend(1, { stage });

  const token = getBearerToken();
  const params = new URLSearchParams({
    'tweet.fields': 'created_at,public_metrics,author_id,attachments,lang',
    expansions: 'author_id,attachments.media_keys',
    'user.fields': 'username,public_metrics',
    'media.fields': 'type,url,preview_image_url',
  });
  const url = `https://api.twitter.com/2/tweets/${encodeURIComponent(id)}?${params}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  const raw = await r.json();
  if (!r.ok) {
    const err = new Error(`X official HTTP ${r.status}: ${raw?.detail || raw?.title || r.statusText}`);
    err.status = r.status;
    err.raw = raw;
    throw err;
  }

  const tweet = raw.data;
  if (!tweet) {
    const err = new Error('X official: tweet not found');
    err.status = 404;
    err.raw = raw;
    throw err;
  }

  const billable = chargePostIds([tweet.id]);
  const newCost = billable * COST_PER_READ;
  logSpendLine(stage, billable, newCost);

  return {
    post: normalizeOfficialPost(tweet, raw.includes || {}),
    raw,
    billableReads: billable,
    totalReads: session.totalReads,
    totalCost: session.totalCost,
  };
}

/**
 * GET /2/tweets/search/recent — one page, max_results capped at 15.
 * @returns {{ posts: object[], raw: object, meta: object, billableReads: number }}
 */
async function searchRecent(query, { startTime, endTime, maxResults = MAX_RESULTS, stage = 'search' } = {}) {
  assertCanSpend(maxResults, { stage });

  const token = getBearerToken();
  const params = new URLSearchParams({
    query,
    max_results: String(Math.min(maxResults, MAX_RESULTS)),
    'tweet.fields': 'created_at,public_metrics,author_id,attachments,lang',
    expansions: 'author_id,attachments.media_keys',
    'user.fields': 'username,public_metrics',
    'media.fields': 'type,url,preview_image_url',
  });
  if (startTime) params.set('start_time', toIsoUtc(startTime));
  if (endTime) params.set('end_time', toIsoUtc(endTime));

  const url = `https://api.twitter.com/2/tweets/search/recent?${params}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  const raw = await r.json();
  if (!r.ok) {
    const err = new Error(`X official HTTP ${r.status}: ${raw?.detail || raw?.title || r.statusText}`);
    err.status = r.status;
    err.raw = raw;
    throw err;
  }

  const tweets = raw.data || [];
  const billable = chargePostIds(tweets.map(t => t.id));
  const newCost = billable * COST_PER_READ;
  logSpendLine(stage, billable, newCost);

  const posts = tweets.map(t => normalizeOfficialPost(t, raw.includes || {}));
  return {
    posts,
    raw,
    meta: raw.meta || {},
    billableReads: billable,
    totalReads: session.totalReads,
    totalCost: session.totalCost,
  };
}

/** X recent search only covers ~7 days; clamp start_time to API floor. */
const RECENT_SEARCH_MAX_AGE_MS = 7 * 86_400_000 - 120_000;

function launchSearchWindow(launchAtIso, hoursBefore) {
  const launchMs = Date.parse(launchAtIso);
  const desiredStart = launchMs - hoursBefore * 3_600_000;
  const endTime = launchMs;
  const apiMinStart = Date.now() - RECENT_SEARCH_MAX_AGE_MS;
  const startTime = Math.max(desiredStart, apiMinStart);
  return {
    startTime,
    endTime,
    launchMs,
    clamped: desiredStart < apiMinStart,
  };
}

module.exports = {
  searchRecent,
  getTweetById,
  getUserByUsername,
  normalizeOfficialPost,
  assertCanSpend,
  chargePostIds,
  spendSummary,
  logSpendLine,
  launchSearchWindow,
  toIsoUtc,
  COST_PER_READ,
  CREDIT_BUDGET,
  MAX_RESULTS,
};
