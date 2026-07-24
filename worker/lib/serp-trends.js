'use strict';

const { withRetry } = require('./retry');

const CACHE_TTL_MS = 45 * 60_000;

const CONFIG = {
  MAX_TRENDS_CALLS_PER_DAY: Number(process.env.MAX_TRENDS_CALLS_PER_DAY) || 200,
  CACHE_TTL_MS,
  SERP_URL: 'https://serpapi.com/search',
};

function utcDateStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

async function loadSerpUsage(sb) {
  const today = utcDateStr();
  const { data, error } = await sb
    .from('worker_usage')
    .select('reads_today')
    .eq('source', 'serpapi')
    .eq('utc_date', today)
    .maybeSingle();
  if (error && !/worker_usage|schema cache/i.test(error.message)) {
    throw new Error('loadSerpUsage: ' + error.message);
  }
  return Number(data?.reads_today) || 0;
}

async function recordSerpUsage(sb) {
  const today = utcDateStr();
  const current = await loadSerpUsage(sb);
  const row = {
    source: 'serpapi',
    utc_date: today,
    reads_today: current + 1,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('worker_usage').upsert(row, { onConflict: 'source,utc_date' });
  if (error && !/worker_usage|schema cache/i.test(error.message)) {
    throw new Error('recordSerpUsage: ' + error.message);
  }
  return current + 1;
}

async function canSpendTrendCall(sb) {
  const callsToday = await loadSerpUsage(sb);
  return callsToday < CONFIG.MAX_TRENDS_CALLS_PER_DAY;
}

async function recordTrendCall(sb) {
  return recordSerpUsage(sb);
}

async function getTrendBudgetState(sb) {
  const callsToday = await loadSerpUsage(sb);
  return {
    callsToday,
    maxCalls: CONFIG.MAX_TRENDS_CALLS_PER_DAY,
    remaining: Math.max(0, CONFIG.MAX_TRENDS_CALLS_PER_DAY - callsToday),
  };
}

async function getCachedTrend(sb, term) {
  const key = (term || '').trim().toLowerCase();
  if (!key) return null;

  const { data, error } = await sb
    .from('worker_trend_cache')
    .select('result, fetched_at')
    .eq('term', key)
    .maybeSingle();

  if (error && !/worker_trend_cache|schema cache/i.test(error.message)) {
    console.warn('[serp-trends] cache read failed:', error.message);
    return null;
  }
  if (!data?.result) return null;
  if (Date.now() - Date.parse(data.fetched_at) > CONFIG.CACHE_TTL_MS) {
    await sb.from('worker_trend_cache').delete().eq('term', key).then(() => {});
    return null;
  }
  return data.result;
}

async function setCachedTrend(sb, term, result) {
  const key = (term || '').trim().toLowerCase();
  if (!key || !result) return;
  const row = {
    term: key,
    result,
    fetched_at: new Date().toISOString(),
  };
  const { error } = await sb.from('worker_trend_cache').upsert(row, { onConflict: 'term' });
  if (error && !/worker_trend_cache|schema cache/i.test(error.message)) {
    console.warn('[serp-trends] cache write failed:', error.message);
  }
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
