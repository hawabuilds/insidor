'use strict';

/**
 * X API billing (twitterapi.io, verified 2026-07-24):
 * - advanced_search + /twitter/tweets bill per TWEET RETURNED (~$0.15 / 1k tweets = $0.00015/tweet)
 * - NOT per HTTP call; a page of 20 tweets = 20 billable units
 *
 * DAILY_TWEET_BUDGET counts tweets. MAX_TWEETS_PER_HOUR = DAILY/12 caps burn rate (~12h runway at peg).
 */

const { loadEnvLocal } = require('./env');
loadEnvLocal();

const LEGACY_DAILY = Number(process.env.DAILY_READ_BUDGET);
const LEGACY_COST = Number(process.env.COST_PER_READ);

function resolveDailyBudget() {
  return Number(process.env.DAILY_TWEET_BUDGET) || LEGACY_DAILY || 33_000;
}

function resolveMaxTweetsPerHour(daily) {
  const explicit = Number(process.env.MAX_TWEETS_PER_HOUR);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  const legacyHourly = Number(process.env.HOURLY_TWEET_CEILING);
  if (Number.isFinite(legacyHourly) && legacyHourly > 0) return Math.floor(legacyHourly);
  return Math.ceil(daily / 12);
}

const DAILY_TWEET_BUDGET = resolveDailyBudget();

const CONFIG = {
  DAILY_TWEET_BUDGET,
  COST_PER_TWEET:
    Number(process.env.COST_PER_TWEET) ||
    LEGACY_COST ||
    0.00015,
  TWEETS_PER_CALL_ESTIMATE: Number(process.env.TWEETS_PER_CALL_ESTIMATE) || 20,
  INGEST_BUDGET_PCT: 0.60,
  SNAPSHOT_BUDGET_PCT: 0.40,
  INGEST_POLL_MS: Number(process.env.INGEST_POLL_MS) || 10 * 60_000,
  SNAPSHOT_POLL_MS: Number(process.env.SNAPSHOT_POLL_MS) || 60_000,
  WARN_PCT: 0.80,
  MAX_PAGES_PER_LANE:
    Number(process.env.MAX_PAGES_PER_LANE) ||
    Number(process.env.INGEST_MAX_PAGES_PER_LANE) ||
    3,
  MAX_TWEETS_PER_HOUR: resolveMaxTweetsPerHour(DAILY_TWEET_BUDGET),
  FLOOR_MIN: 300,
  FLOOR_MAX: 50_000,
  DEFAULT_ADAPTIVE_FLOOR: 1000,
  MEDIA_LANE_PCT_DEFAULT: 0.25,
  MEDIA_LANE_PCT_MIN: 0.15,
  MEDIA_LANE_PCT_MAX: 0.45,
  MEDIA_LANE_MIN_SAMPLE: 15,
};

/** @deprecated */
CONFIG.INGEST_MAX_PAGES_PER_LANE = CONFIG.MAX_PAGES_PER_LANE;
/** @deprecated */
CONFIG.HOURLY_TWEET_CEILING = CONFIG.MAX_TWEETS_PER_HOUR;
/** @deprecated */
CONFIG.DAILY_READ_BUDGET = CONFIG.DAILY_TWEET_BUDGET;
/** @deprecated */
CONFIG.COST_PER_READ = CONFIG.COST_PER_TWEET;

function assertXBudgetConfig() {
  const daily = CONFIG.DAILY_TWEET_BUDGET;
  const hourly = CONFIG.MAX_TWEETS_PER_HOUR;
  if (!Number.isFinite(daily) || daily <= 0) {
    throw new Error('DAILY_TWEET_BUDGET must be a positive number');
  }
  if (!Number.isFinite(hourly) || hourly <= 0) {
    throw new Error('MAX_TWEETS_PER_HOUR must be a positive number');
  }
  if (hourly > daily) {
    throw new Error(
      `X budget config conflict: MAX_TWEETS_PER_HOUR (${hourly.toLocaleString()}) ` +
      `exceeds DAILY_TWEET_BUDGET (${daily.toLocaleString()})`,
    );
  }
  const explicitHourly =
    Number(process.env.MAX_TWEETS_PER_HOUR) ||
    Number(process.env.HOURLY_TWEET_CEILING);
  if (Number.isFinite(explicitHourly) && explicitHourly > 0 && explicitHourly * 24 > daily) {
    throw new Error(
      `X budget config conflict: MAX_TWEETS_PER_HOUR (${explicitHourly.toLocaleString()}) × 24 = ` +
      `${(explicitHourly * 24).toLocaleString()} exceeds DAILY_TWEET_BUDGET (${daily.toLocaleString()}). ` +
      `Lower MAX_TWEETS_PER_HOUR or raise DAILY_TWEET_BUDGET.`,
    );
  }
}

function utcDateStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function msUntilUtcMidnight() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(0, next - now.getTime());
}

function cycleBudget(worker, pollMs) {
  const cyclesPerDay = Math.max(1, Math.floor(86_400_000 / pollMs));
  const pct = worker === 'snapshotter' ? CONFIG.SNAPSHOT_BUDGET_PCT : CONFIG.INGEST_BUDGET_PCT;
  return Math.max(1, Math.floor(CONFIG.DAILY_TWEET_BUDGET * pct / cyclesPerDay));
}

function costUsd(tweets) {
  return tweets * CONFIG.COST_PER_TWEET;
}

function normalizeHourly(state) {
  if (!state) return { hourly_tweets: 0, hourly_window_start: new Date().toISOString() };
  const startMs = state.hourly_window_start ? Date.parse(state.hourly_window_start) : 0;
  const now = Date.now();
  if (!startMs || !Number.isFinite(startMs) || now - startMs >= 3_600_000) {
    return { hourly_tweets: 0, hourly_window_start: new Date().toISOString() };
  }
  return {
    hourly_tweets: state.hourly_tweets || 0,
    hourly_window_start: state.hourly_window_start,
  };
}

function hourlyTweets(state) {
  return normalizeHourly(state).hourly_tweets || 0;
}

function msUntilNextHourBoundary(state) {
  const hourly = normalizeHourly(state);
  const startMs = Date.parse(hourly.hourly_window_start);
  if (!Number.isFinite(startMs)) return 3_600_000;
  const elapsed = Date.now() - startMs;
  return Math.max(0, 3_600_000 - elapsed);
}

function isHourlyDormant(state) {
  return hourlyTweets(state) >= CONFIG.MAX_TWEETS_PER_HOUR;
}

function isDormant(state) {
  return (state.reads_today || 0) >= CONFIG.DAILY_TWEET_BUDGET;
}

function isSpendBlocked(state) {
  return isDormant(state) || isHourlyDormant(state);
}

function remainingDailyTweets(state) {
  return Math.max(0, CONFIG.DAILY_TWEET_BUDGET - (state.reads_today || 0));
}

function remainingHourlyTweets(state) {
  return Math.max(0, CONFIG.MAX_TWEETS_PER_HOUR - hourlyTweets(state));
}

function wouldExceedBudget(state, estimatedTweets = CONFIG.TWEETS_PER_CALL_ESTIMATE) {
  return estimatedTweets > remainingDailyTweets(state) || estimatedTweets > remainingHourlyTweets(state);
}

/** @deprecated */
function isHourlyCeiling(state, additionalTweets = 0) {
  return hourlyTweets(state) + additionalTweets >= CONFIG.MAX_TWEETS_PER_HOUR;
}

function canAffordPage(state, estimatedTweets = CONFIG.TWEETS_PER_CALL_ESTIMATE) {
  if (isSpendBlocked(state)) return false;
  return !wouldExceedBudget(state, estimatedTweets);
}

/** @deprecated — use canAffordPage */
function canSpend(state, n) {
  return canAffordPage(state, n);
}

function projectDailyTweets(state, cycleTweets = 0) {
  const hourly = normalizeHourly(state);
  const hourTweets = (hourly.hourly_tweets || 0) + cycleTweets;
  const startMs = Date.parse(hourly.hourly_window_start);
  const elapsedMs = Math.max(60_000, Date.now() - (Number.isFinite(startMs) ? startMs : Date.now()));
  return Math.round((hourTweets / elapsedMs) * 86_400_000);
}

function logHourlyCeiling(state) {
  const mins = Math.ceil(msUntilNextHourBoundary(state) / 60_000);
  console.error(
    '\n' + '='.repeat(72) + '\n' +
    '  X HOURLY TWEET CAP HIT — dormant until next hour boundary\n' +
    `  hour ${hourlyTweets(state).toLocaleString()}/${CONFIG.MAX_TWEETS_PER_HOUR.toLocaleString()} tweets ` +
    `(resume in ~${mins}m)\n` +
    '='.repeat(72) + '\n',
  );
}

function logDailyCeiling(state) {
  const mins = Math.round(msUntilUtcMidnight() / 60_000);
  console.error(
    '\n' + '='.repeat(72) + '\n' +
    '  X DAILY TWEET BUDGET EXHAUSTED — dormant until UTC midnight\n' +
    `  today ${(state.reads_today || 0).toLocaleString()}/${CONFIG.DAILY_TWEET_BUDGET.toLocaleString()} tweets ` +
    `(~${mins}m remaining)\n` +
    '='.repeat(72) + '\n',
  );
}

/**
 * Check before each paginated X API request. Reloads state from DB.
 * Returns { ok, state, reason } where reason is daily|hourly|budget|blocked.
 */
async function assertCanRequestPage(sb, stateHint = null) {
  let state = stateHint;
  try {
    state = await loadState(sb);
  } catch (e) {
    return { ok: false, state: stateHint, reason: 'load_failed', error: e.message };
  }

  if (isDormant(state)) {
    logDailyCeiling(state);
    return { ok: false, state, reason: 'daily' };
  }
  if (isHourlyDormant(state)) {
    logHourlyCeiling(state);
    return { ok: false, state, reason: 'hourly' };
  }
  if (!canAffordPage(state)) {
    if (remainingHourlyTweets(state) < CONFIG.TWEETS_PER_CALL_ESTIMATE) {
      logHourlyCeiling(state);
      return { ok: false, state, reason: 'hourly' };
    }
    if (remainingDailyTweets(state) < CONFIG.TWEETS_PER_CALL_ESTIMATE) {
      logDailyCeiling(state);
      return { ok: false, state, reason: 'daily' };
    }
    return { ok: false, state, reason: 'budget' };
  }
  return { ok: true, state };
}

function formatBudgetLine(cycleTweets, tweetsToday, cycleMeta = {}) {
  const apiCalls = Number(cycleMeta.apiCalls) || 0;
  const hourTweets = Number(cycleMeta.hourTweets ?? tweetsToday);
  const projectedDaily = Number(cycleMeta.projectedDailyTweets) || 0;
  const todayPct = ((tweetsToday / CONFIG.DAILY_TWEET_BUDGET) * 100).toFixed(1);
  const hourPct = ((hourTweets / CONFIG.MAX_TWEETS_PER_HOUR) * 100).toFixed(1);
  const projectedUsd = costUsd(projectedDaily);
  return (
    `cycle · ${apiCalls} calls · ${Number(cycleTweets).toLocaleString()} tweets · ` +
    `hour ${hourTweets.toLocaleString()}/${CONFIG.MAX_TWEETS_PER_HOUR.toLocaleString()} (${hourPct}%) · ` +
    `today ${tweetsToday.toLocaleString()}/${CONFIG.DAILY_TWEET_BUDGET.toLocaleString()} (${todayPct}%, ~$${costUsd(tweetsToday).toFixed(2)}) · ` +
    `projected ~${projectedDaily.toLocaleString()} tweets/day (~$${projectedUsd.toFixed(2)} at current burn)`
  );
}

function buildBudgetMeta(state, cycleTweets, apiCalls) {
  const projectedDaily = projectDailyTweets(state, 0);
  return {
    apiCalls,
    hourTweets: hourlyTweets(state),
    projectedDailyTweets: projectedDaily,
  };
}

async function loadState(sb) {
  const today = utcDateStr();
  const { data, error } = await sb.from('worker_budget_state').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error('budget state: ' + error.message);

  const { normalizeStateFloors, DEFAULTS: FLOOR_DEFAULTS } = require('./ingest-floors');

  if (!data) {
    const row = {
      id: 1,
      utc_date: today,
      reads_today: 0,
      hourly_tweets: 0,
      hourly_window_start: new Date().toISOString(),
      adaptive_floor: FLOOR_DEFAULTS['catch-all'],
      floor_min: CONFIG.FLOOR_MIN,
      floor_catch_all: FLOOR_DEFAULTS['catch-all'],
      floor_slow_burn: FLOOR_DEFAULTS['slow-burn'],
      floor_media: FLOOR_DEFAULTS['media-lane'],
      media_lane_pct: CONFIG.MEDIA_LANE_PCT_DEFAULT,
      updated_at: new Date().toISOString(),
    };
    await sb.from('worker_budget_state').insert(row);
    return normalizeStateFloors(row);
  }

  const hourly = normalizeHourly(data);

  if (data.utc_date !== today) {
    const { data: reset, error: upErr } = await sb
      .from('worker_budget_state')
      .update({
        utc_date: today,
        reads_today: 0,
        hourly_tweets: 0,
        hourly_window_start: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)
      .select('*')
      .single();
    if (upErr) throw new Error('budget reset: ' + upErr.message);
    return normalizeStateFloors(reset);
  }

  if (
    hourly.hourly_tweets !== (data.hourly_tweets || 0) ||
    hourly.hourly_window_start !== data.hourly_window_start
  ) {
    data.hourly_tweets = hourly.hourly_tweets;
    data.hourly_window_start = hourly.hourly_window_start;
  }

  return normalizeStateFloors(data);
}

async function recordReads(sb, tweetCount, worker = 'unknown', meta = {}) {
  if (!tweetCount || tweetCount <= 0) return loadState(sb);
  const state = await loadState(sb);
  const tweetsToday = (state.reads_today || 0) + tweetCount;
  const hourly = normalizeHourly(state);
  const hourlyTweetsNext = (hourly.hourly_tweets || 0) + tweetCount;

  const { data, error } = await sb
    .from('worker_budget_state')
    .update({
      reads_today: tweetsToday,
      hourly_tweets: hourlyTweetsNext,
      hourly_window_start: hourly.hourly_window_start,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
    .select('*')
    .single();
  if (error) throw new Error(`budget record (${worker}): ` + error.message);

  if (isHourlyDormant(data)) {
    logHourlyCeiling(data);
  } else if (isDormant(data)) {
    logDailyCeiling(data);
  }

  try {
    await recordSourceUsage(sb, tweetCount, 'x');
  } catch (e) {
    console.warn('[budget] worker_usage (x) sync failed:', e.message);
  }

  return data;
}

async function waitIfSpendBlocked(sb) {
  let state = await loadState(sb);
  if (isDormant(state)) {
    logDailyCeiling(state);
    await sleepMs(msUntilUtcMidnight());
    return loadState(sb);
  }
  if (isHourlyDormant(state)) {
    logHourlyCeiling(state);
    await sleepMs(msUntilNextHourBoundary(state));
    return loadState(sb);
  }
  return state;
}

function sleepMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function recordSourceUsage(sb, tweets, source) {
  if (!tweets || tweets <= 0) return;
  const today = utcDateStr();
  const cost = tweets * CONFIG.COST_PER_TWEET;

  const { data: existing } = await sb
    .from('worker_usage')
    .select('reads_today, cost_usd')
    .eq('source', source)
    .eq('utc_date', today)
    .maybeSingle();

  if (!existing) {
    await sb.from('worker_usage').insert({
      source,
      utc_date: today,
      reads_today: tweets,
      cost_usd: cost,
      updated_at: new Date().toISOString(),
    });
    return;
  }

  await sb
    .from('worker_usage')
    .update({
      reads_today: (existing.reads_today || 0) + tweets,
      cost_usd: (Number(existing.cost_usd) || 0) + cost,
      updated_at: new Date().toISOString(),
    })
    .eq('source', source)
    .eq('utc_date', today);
}

async function recordPostsIngested(sb, source, n) {
  if (!n || n <= 0 || !sb) return;
  const today = utcDateStr();

  const { data: existing } = await sb
    .from('worker_usage')
    .select('posts_ingested, reads_today, cost_usd')
    .eq('source', source)
    .eq('utc_date', today)
    .maybeSingle();

  if (!existing) {
    await sb.from('worker_usage').insert({
      source,
      utc_date: today,
      reads_today: 0,
      cost_usd: 0,
      posts_ingested: n,
      updated_at: new Date().toISOString(),
    });
    return;
  }

  await sb
    .from('worker_usage')
    .update({
      posts_ingested: (existing.posts_ingested || 0) + n,
      updated_at: new Date().toISOString(),
    })
    .eq('source', source)
    .eq('utc_date', today);
}

function spendPct(state) {
  return (state.reads_today || 0) / CONFIG.DAILY_TWEET_BUDGET;
}

function isWarn(state) {
  return spendPct(state) >= CONFIG.WARN_PCT;
}

async function setAdaptiveFloor(sb, floor, reason) {
  const clamped = Math.max(CONFIG.FLOOR_MIN, Math.min(CONFIG.FLOOR_MAX, Math.round(floor)));
  const { data, error } = await sb
    .from('worker_budget_state')
    .update({ adaptive_floor: clamped, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select('adaptive_floor')
    .single();
  if (error) throw new Error('set adaptive floor: ' + error.message);
  console.log(`[budget] adaptive_floor → ${clamped} (${reason})`);
  return data.adaptive_floor;
}

/** @deprecated Use ingest-floors.adjustLaneFloor — global floor ratchet removed. */
async function adjustAdaptiveFloor(sb, state, returnedCount, targetReads, extraReason = '') {
  let floor = state.adaptive_floor || CONFIG.DEFAULT_ADAPTIVE_FLOOR;
  let reason = 'unchanged';

  if (isWarn(state)) {
    floor = Math.ceil(floor * 1.2);
    reason = 'budget ≥80% — raise 20%';
  } else if (returnedCount > targetReads) {
    floor = Math.ceil(floor * 1.2);
    reason = `returned ${returnedCount} > target ${targetReads} — raise 20%`;
  } else if (returnedCount < targetReads * 0.6) {
    floor = Math.floor(floor * 0.8);
    reason = `returned ${returnedCount} < 60% of target ${targetReads} — lower 20%`;
  }

  if (extraReason) reason += `; ${extraReason}`;
  floor = Math.max(state.floor_min || CONFIG.FLOOR_MIN, Math.min(CONFIG.FLOOR_MAX, floor));
  if (floor !== state.adaptive_floor) await setAdaptiveFloor(sb, floor, reason);
  return floor;
}

/** @deprecated Use ingest-floors cap/decay — view-drop floor_min ratchet removed. */
async function raiseFloorMin(sb, state, factor = 1.2) {
  const next = Math.min(CONFIG.FLOOR_MAX, Math.ceil((state.floor_min || CONFIG.FLOOR_MIN) * factor));
  if (next === state.floor_min) return next;
  await sb.from('worker_budget_state').update({ floor_min: next, updated_at: new Date().toISOString() }).eq('id', 1);
  console.warn(`[budget] floor_min raised → ${next} (>70% view drops)`);
  return next;
}

function mediaLanePct(state) {
  const pct = Number(state.media_lane_pct);
  return Number.isFinite(pct) ? pct : CONFIG.MEDIA_LANE_PCT_DEFAULT;
}

/** Shift discovery budget toward media lane when it converts to display_eligible faster. */
async function adjustMediaLaneBudget(sb, state) {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await sb
    .from('narrative_posts')
    .select('filter_label, narrative_id, narratives!narrative_posts_narrative_id_fkey ( display_eligible )')
    .gte('first_seen_at', since)
    .not('narrative_id', 'is', null);

  if (error) {
    console.warn('[budget] media_lane_pct check failed:', error.message);
    return mediaLanePct(state);
  }

  let mediaTotal = 0;
  let mediaEligible = 0;
  let textTotal = 0;
  let textEligible = 0;

  for (const row of data || []) {
    const narrative = Array.isArray(row.narratives) ? row.narratives[0] : row.narratives;
    const eligible = !!narrative?.display_eligible;
    if (row.filter_label === 'media-lane') {
      mediaTotal += 1;
      if (eligible) mediaEligible += 1;
    } else if (row.filter_label === 'catch-all' || row.filter_label === 'slow-burn') {
      textTotal += 1;
      if (eligible) textEligible += 1;
    }
  }

  const current = mediaLanePct(state);
  if (mediaTotal < CONFIG.MEDIA_LANE_MIN_SAMPLE || textTotal < CONFIG.MEDIA_LANE_MIN_SAMPLE) {
    return current;
  }

  const mediaRate = mediaEligible / mediaTotal;
  const textRate = textEligible / textTotal;
  let next = current;
  let reason = null;

  if (mediaRate > textRate * 1.15) {
    next = Math.min(CONFIG.MEDIA_LANE_PCT_MAX, current + 0.05);
    reason = `media display ${(mediaRate * 100).toFixed(1)}% > text ${(textRate * 100).toFixed(1)}% — +5%`;
  } else if (mediaRate < textRate * 0.85) {
    next = Math.max(CONFIG.MEDIA_LANE_PCT_MIN, current - 0.05);
    reason = `media display ${(mediaRate * 100).toFixed(1)}% < text ${(textRate * 100).toFixed(1)}% — -5%`;
  }

  if (reason && next !== current) {
    const { error: upErr } = await sb
      .from('worker_budget_state')
      .update({ media_lane_pct: next, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (upErr) console.warn('[budget] media_lane_pct update failed:', upErr.message);
    else console.log(`[budget] media_lane_pct → ${(next * 100).toFixed(0)}% (${reason})`);
  }

  return next;
}

async function getHistory(sb, days = 7) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await sb
    .from('worker_cycle_log')
    .select('worker, ran_at, reads_consumed, ingested, snapshots_written')
    .gte('ran_at', since)
    .order('ran_at', { ascending: false });
  if (error) throw new Error('budget history: ' + error.message);
  return data || [];
}

module.exports = {
  CONFIG,
  utcDateStr,
  msUntilUtcMidnight,
  msUntilNextHourBoundary,
  cycleBudget,
  costUsd,
  formatBudgetLine,
  buildBudgetMeta,
  loadState,
  recordReads,
  waitIfSpendBlocked,
  assertCanRequestPage,
  spendPct,
  isDormant,
  isHourlyDormant,
  isSpendBlocked,
  isWarn,
  canSpend,
  canAffordPage,
  isHourlyCeiling,
  logHourlyCeiling,
  logDailyCeiling,
  remainingDailyTweets,
  remainingHourlyTweets,
  projectDailyTweets,
  assertXBudgetConfig,
  setAdaptiveFloor,
  adjustAdaptiveFloor,
  raiseFloorMin,
  mediaLanePct,
  adjustMediaLaneBudget,
  getHistory,
  recordSourceUsage,
  recordPostsIngested,
};
