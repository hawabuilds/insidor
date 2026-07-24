'use strict';

const { withRetry } = require('./retry');

const CACHE_TTL_MS = 45 * 60_000;

const CONFIG = {
  MAX_TRENDS_CALLS_PER_DAY: Number(process.env.MAX_TRENDS_CALLS_PER_DAY) || 200,
  CACHE_TTL_MS,
  SERP_URL: 'https://serpapi.com/search',
};

const termCache = new Map();
let callsToday = 0;
let utcDate = new Date().toISOString().slice(0, 10);

function utcDateStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function resetDayIfNeeded() {
  const today = utcDateStr();
  if (today !== utcDate) {
    utcDate = today;
    callsToday = 0;
  }
}

function canSpendTrendCall() {
  resetDayIfNeeded();
  return callsToday < CONFIG.MAX_TRENDS_CALLS_PER_DAY;
}

function recordTrendCall() {
  resetDayIfNeeded();
  callsToday += 1;
}

function getTrendBudgetState() {
  resetDayIfNeeded();
  return {
    callsToday,
    maxCalls: CONFIG.MAX_TRENDS_CALLS_PER_DAY,
    remaining: Math.max(0, CONFIG.MAX_TRENDS_CALLS_PER_DAY - callsToday),
  };
}

function getCachedTrend(term) {
  const key = (term || '').trim().toLowerCase();
  if (!key) return null;
  const hit = termCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.fetchedAt > CONFIG.CACHE_TTL_MS) {
    termCache.delete(key);
    return null;
  }
  return hit.result;
}

function setCachedTrend(term, result) {
  const key = (term || '').trim().toLowerCase();
  if (!key || !result) return;
  termCache.set(key, { result, fetchedAt: Date.now() });
}

function parseTimeseries(body) {
  const timeline = body?.interest_over_time?.timeline_data;
  if (!Array.isArray(timeline) || !timeline.length) {
    throw new Error('no interest_over_time.timeline_data');
  }

  const series = timeline.map((point) => {
    const values = point?.values || [];
    const hit = values.find(v => v?.extracted_value != null) || values[0];
    if (hit?.extracted_value != null) return Number(hit.extracted_value) || 0;
    if (hit?.value != null) return Number(hit.value) || 0;
    return 0;
  });

  if (!series.length || series.every(v => v === 0)) {
    throw new Error('empty interest series');
  }

  return series;
}

function trendDirection(series) {
  if (!series || series.length < 3) return 'flat';
  const third = Math.max(2, Math.floor(series.length / 3));
  const tail = series.slice(-third);
  const slope = (tail[tail.length - 1] - tail[0]) / Math.max(tail.length - 1, 1);
  if (slope > 1.5) return 'rising';
  if (slope < -1.5) return 'falling';
  return 'flat';
}

function normalizeTrendResult(series) {
  const peak = Math.max(...series);
  return {
    series,
    peak,
    direction: trendDirection(series),
  };
}

async function fetchGoogleTrends(term, apiKey) {
  const q = (term || '').trim();
  if (!q) throw new Error('empty trend term');
  if (!apiKey) throw new Error('missing SERPAPI_KEY');

  const url = new URL(CONFIG.SERP_URL);
  url.searchParams.set('engine', 'google_trends');
  url.searchParams.set('q', q);
  url.searchParams.set('data_type', 'TIMESERIES');
  url.searchParams.set('date', 'now 1-d');
  url.searchParams.set('geo', 'US');
  url.searchParams.set('api_key', apiKey);

  const body = await withRetry(async () => {
    const r = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!r.ok) {
      const err = new Error(`SerpAPI HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return r.json();
  }, { label: `serp-trends:${q.slice(0, 32)}` });

  if (body.error) throw new Error(body.error);
  const series = parseTimeseries(body);
  return normalizeTrendResult(series);
}

module.exports = {
  CONFIG,
  fetchGoogleTrends,
  getCachedTrend,
  setCachedTrend,
  canSpendTrendCall,
  recordTrendCall,
  getTrendBudgetState,
  trendDirection,
  parseTimeseries,
  normalizeTrendResult,
};
