#!/usr/bin/env node
'use strict';

/**
 * Catch-all viral ingest — adaptive min_faves floor, budget-bounded.
 * Run: node worker/ingest.js
 */

const { getServiceClient } = require('./lib/supabase');
const { searchTweets, buildAdvancedSearchUrl, tweetsInResponse } = require('./lib/x-reader');
const { parseRawPost } = require('./lib/parse-raw-post');
const { insertPostSnapshot, engagementFromParsed } = require('./lib/snapshots');
const { logCycle } = require('./lib/cycle-log');
const { upsertNearMiss, recheckNearMisses } = require('./lib/near-miss');
const { upsertIngestedPost } = require('./lib/ingest-upsert');
const { buildQueries, buildMediaQueries, recencyWindow } = require('./lib/ingest-query');
const {
  CONFIG: BUDGET,
  loadState,
  recordReads,
  waitIfSpendBlocked,
  assertCanRequestPage,
  isSpendBlocked,
  isWarn,
  adjustMediaLaneBudget,
  mediaLanePct,
  cycleBudget,
  formatBudgetLine,
  buildBudgetMeta,
  msUntilUtcMidnight,
  recordPostsIngested,
  assertXBudgetConfig,
} = require('./lib/budget');
const {
  resolveLaneFloor,
  adjustLaneFloor,
  getLaneFloors,
  maybeDecayFloorsForUnderutilisation,
  checkIngestHealthAlarm,
} = require('./lib/ingest-floors');
const { sleep } = require('./lib/retry');
const { loadEnvLocal } = require('./lib/env');
const {
  isPostWithinMaxAge,
  trackIngestAge,
  formatRecencyLog,
} = require('./lib/posted-at');
const { logIngestLane, logIngestCycleSummary } = require('./lib/ingest-funnel');

const CONFIG = {
  POLL_MS: BUDGET.INGEST_POLL_MS,
  CATCH_ALL_EVERY_MS: BUDGET.INGEST_POLL_MS,
  RECENCY_MIN: 30,
  SLOW_BURN_EVERY_MS: Number(process.env.SLOW_BURN_EVERY_MS) || BUDGET.INGEST_POLL_MS,
  SLOW_BURN_RECENCY_MIN: 6 * 60,
  NEAR_MISS_EVERY_MS: Number(process.env.NEAR_MISS_EVERY_MS) || BUDGET.INGEST_POLL_MS,
  MIN_INGEST_VIEWS: Number(process.env.MIN_INGEST_VIEWS) || 30_000,
  MAX_POST_AGE_MIN_X: Number(process.env.MAX_POST_AGE_MIN_X) || 360,
  VIEW_DROP_WARN_PCT: 0.70,
  QUERY_TYPE_PRIMARY: process.env.INGEST_QUERY_TYPE || 'Latest',
  QUERY_TYPE_FALLBACK: 'Top',
  ENABLE_TOP_PASS: process.env.ENABLE_TOP_PASS !== 'false',
};

function keptPct(returned, ingested) {
  if (!returned) return '0.0';
  return ((ingested / returned) * 100).toFixed(1);
}

let lastCatchAll = 0;
let lastSlowBurn = 0;
let lastNearMiss = 0;
let degradedMode = false;
let selfTestDone = false;
let logRequestUrlThisCycle = false;

async function runIngestSelfTest() {
  loadEnvLocal();
  if (!process.env.X_API_KEY) {
    console.warn('[ingest] self-test skipped — X_API_KEY not set');
    return true;
  }

  const windowMin = CONFIG.RECENCY_MIN;
  const query = buildQueries(100, windowMin)[0];
  const { since_time: sinceSec } = recencyWindow(windowMin);
  const url = buildAdvancedSearchUrl(query, CONFIG.QUERY_TYPE_PRIMARY);

  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const data = await searchTweets(query, CONFIG.QUERY_TYPE_PRIMARY);
      const raw = tweetsInResponse(data);
      if (raw > 0) {
        console.log(`[ingest] self-test url: ${url} (X-API-Key: [redacted])`);
        console.log(
          `[ingest] self-test ok — api_raw=${raw} queryType=${CONFIG.QUERY_TYPE_PRIMARY} ` +
          `(min_faves:100, since_time=${sinceSec})`,
        );
        return true;
      }
      if (attempt < 2) await sleep(2000);
    }

    console.error(
      '\n' + '='.repeat(72) + '\n' +
      '  INGEST SELF-TEST FAILED — query construction likely broken\n' +
      `  expected api_raw > 0 for min_faves:100 with ${windowMin}m since_time in query\n` +
      `  url: ${url}\n` +
      '  (X-API-Key sent in header only — not in URL)\n' +
      '='.repeat(72) + '\n',
    );
    return false;
  } catch (e) {
    console.error(
      '\n' + '='.repeat(72) + '\n' +
      '  INGEST SELF-TEST FAILED — query construction likely broken\n' +
      `  ${e.message}\n` +
      `  url: ${url}\n` +
      '='.repeat(72) + '\n',
    );
    return false;
  }
}

function maybeLogSearchRequest(query, queryType) {
  if (logRequestUrlThisCycle) return;
  logRequestUrlThisCycle = true;
  const url = buildAdvancedSearchUrl(query, queryType);
  console.log(`[ingest] request url: ${url} queryType=${queryType} (X-API-Key: [redacted])`);
}

function resolveFloor(state, laneKey, recencyMin) {
  const { base, effective } = resolveLaneFloor(state, laneKey, recencyMin);
  return { base, effective };
}

/** Print self-test vs lane URLs built at the same instant for diffing. */
function logQueryUrlDiff(state, laneKey, recencyMin, buildQueryFn = buildQueries) {
  const nowMs = Date.now();
  const selfTestQuery = buildQueries(100, recencyMin, nowMs)[0];
  const { base, effective } = resolveFloor(state, laneKey, recencyMin);
  const laneQuery = buildQueryFn(effective, recencyMin, nowMs)[0];
  const selfTestUrl = buildAdvancedSearchUrl(selfTestQuery, CONFIG.QUERY_TYPE_PRIMARY);
  const laneUrl = buildAdvancedSearchUrl(laneQuery, CONFIG.QUERY_TYPE_PRIMARY);
  const stripFaves = (q) => q.replace(/min_faves:\d+/g, 'min_faves:?');

  console.log(
    `[ingest] url diff — self-test (min_faves:100) vs ${laneKey} ` +
    `(base=${base} effective=${effective}, ${recencyMin}m):`,
  );
  console.log(`  self-test:  ${selfTestUrl}`);
  console.log(`  ${laneKey}:  ${laneUrl}`);
  console.log('  (X-API-Key: [redacted])');

  if (stripFaves(selfTestQuery) === stripFaves(laneQuery) && effective > 100) {
    console.warn(
      `[ingest] url diff — identical except min_faves (100 vs ${effective}); ` +
      `if ${laneKey} api_raw=0, floor is too high for a ${recencyMin}m window`,
    );
  }
}

async function paginatedSearch(sb, stateRef, label, laneKey, recencyMin, tweetBudget, options = {}) {
  const buildQueryFn = options.buildQueryFn || buildQueries;
  const pageBudget = options.pageBudget;
  const { base, effective } = resolveFloor(stateRef.current, laneKey, recencyMin);
  const maxPagesPerLane = BUDGET.MAX_PAGES_PER_LANE;

  let tweetsProcessed = 0;
  let tweetsBilled = 0;
  let returned = 0;
  let rawFromApi = 0;
  let ingested = 0;
  let skippedViews = 0;
  let skippedStale = 0;
  let ingestAgesMin = [];
  let pages = 0;
  let apiCalls = 0;
  let queryUsed = null;
  let stopReason = null;
  let latestRaw = 0;
  let topRaw = 0;
  let topPassUnique = 0;
  let topPassDuplicates = 0;
  const seenPostIds = new Set();
  const mode = degradedMode ? 'degraded' : label;

  async function processTweets(tweets, procOpts = {}) {
    const batch = tweets || [];
    const nowMs = Date.now();
    for (const raw of batch) {
      const platformId = String(raw?.id ?? raw?.id_str ?? '');
      if (procOpts.topPass && platformId && seenPostIds.has(platformId)) {
        topPassDuplicates += 1;
        continue;
      }
      if (platformId) seenPostIds.add(platformId);

      if (tweetsProcessed >= tweetBudget) break;
      tweetsProcessed += 1;
      returned += 1;
      rawFromApi += 1;
      if (procOpts.topPass && platformId) topPassUnique += 1;

      try {
        const parsed = parseRawPost(raw);
        if (!isPostWithinMaxAge(parsed, CONFIG.MAX_POST_AGE_MIN_X, nowMs)) {
          skippedStale += 1;
          continue;
        }
        if ((parsed.views ?? 0) < CONFIG.MIN_INGEST_VIEWS) {
          skippedViews += 1;
          await upsertNearMiss(sb, parsed);
          continue;
        }
        const postId = await upsertIngestedPost(sb, parsed, label);
        if (!postId) continue;
        await insertPostSnapshot(sb, postId, engagementFromParsed(parsed));
        ingested += 1;
        trackIngestAge({ ingestAgesMin }, parsed, nowMs);
      } catch (e) {
        console.warn(`[ingest] ${label} parse failed:`, e.message);
      }
    }
  }

  async function executeSearch(query, queryType, cursor = '') {
    if (!cursor) maybeLogSearchRequest(query, queryType);
    apiCalls += 1;
    return searchTweets(query, queryType, cursor);
  }

  async function billPage(data, queryType) {
    const pageTweets = tweetsInResponse(data);
    if (queryType === CONFIG.QUERY_TYPE_PRIMARY) latestRaw += pageTweets;
    else topRaw += pageTweets;
    tweetsBilled += pageTweets;
    if (pageTweets > 0) {
      stateRef.current = await recordReads(sb, pageTweets, 'ingest');
    }
    return pageTweets;
  }

  async function fetchPaginatedPage(query, cursor = '') {
    if (pages >= maxPagesPerLane) {
      stopReason = 'lane_pages';
      return null;
    }
    if (pageBudget && pageBudget.used >= pageBudget.max) {
      stopReason = 'cycle_pages';
      return null;
    }

    const gate = await assertCanRequestPage(sb, stateRef.current);
    stateRef.current = gate.state || stateRef.current;
    if (!gate.ok) {
      stopReason = gate.reason || 'blocked';
      return null;
    }

    pages += 1;
    if (pageBudget) pageBudget.used += 1;

    const latestData = await executeSearch(query, CONFIG.QUERY_TYPE_PRIMARY, cursor);
    let pageTweets = await billPage(latestData, CONFIG.QUERY_TYPE_PRIMARY);
    let data = latestData;
    let resultType = CONFIG.QUERY_TYPE_PRIMARY;
    await processTweets(latestData.tweets || [], { queryType: resultType });

    if (pageTweets === 0) {
      const topData = await executeSearch(query, CONFIG.QUERY_TYPE_FALLBACK, cursor);
      const topTweets = await billPage(topData, CONFIG.QUERY_TYPE_FALLBACK);
      if (topTweets > 0) {
        data = topData;
        resultType = CONFIG.QUERY_TYPE_FALLBACK;
        pageTweets = topTweets;
        await processTweets(topData.tweets || [], { queryType: resultType });
        console.log(
          `[ingest] ${label} queryType ${CONFIG.QUERY_TYPE_PRIMARY} api_raw=0 → ` +
          `${CONFIG.QUERY_TYPE_FALLBACK} fallback api_raw=${topTweets}`,
        );
      } else {
        console.log(
          `[ingest] ${label} queryType ${CONFIG.QUERY_TYPE_PRIMARY} api_raw=0 → ` +
          `${CONFIG.QUERY_TYPE_FALLBACK} fallback api_raw=0`,
        );
      }
    }

    return { data, resultType, pageTweets };
  }

  async function runTopPass(query) {
    if (!CONFIG.ENABLE_TOP_PASS || !query) return;
    if (pages >= maxPagesPerLane) return;

    const gate = await assertCanRequestPage(sb, stateRef.current);
    stateRef.current = gate.state || stateRef.current;
    if (!gate.ok) return;

    pages += 1;
    if (pageBudget) pageBudget.used += 1;

    const topData = await executeSearch(query, CONFIG.QUERY_TYPE_FALLBACK, '');
    const topTweets = await billPage(topData, CONFIG.QUERY_TYPE_FALLBACK);
    const uniqueBefore = topPassUnique;
    await processTweets(topData.tweets || [], { queryType: CONFIG.QUERY_TYPE_FALLBACK, topPass: true });
    const uniqueAdded = topPassUnique - uniqueBefore;

    console.log(
      `[ingest] ${label} top_pass queryType=${CONFIG.QUERY_TYPE_FALLBACK} ` +
      `api_raw=${topTweets} unique=${uniqueAdded} dupes=${topPassDuplicates} ` +
      `(seen=${seenPostIds.size} ENABLE_TOP_PASS=${CONFIG.ENABLE_TOP_PASS})`,
    );
  }

  const queries = buildQueryFn(effective, recencyMin, Date.now(), degradedMode);
  let cursor = '';
  let started = false;

  for (let qi = 0; qi < queries.length; qi += 1) {
    const q = queries[qi];
    try {
      let page = await fetchPaginatedPage(q);
      if (!page) break;
      queryUsed = q;
      let data = page.data;
      cursor = data.next_cursor || '';
      started = true;

      while (
        data.has_next_page &&
        cursor &&
        tweetsProcessed < tweetBudget &&
        pages < maxPagesPerLane &&
        (!pageBudget || pageBudget.used < pageBudget.max)
      ) {
        page = await fetchPaginatedPage(queryUsed, cursor);
        if (!page) break;
        data = page.data;
        if (!data.has_next_page || !data.next_cursor) break;
        cursor = data.next_cursor;
      }
      break;
    } catch (e) {
      if (qi === queries.length - 1 && !degradedMode) {
        console.warn('[ingest] ⚠ DEGRADED MODE — keyword-free query rejected; using ultra-broad "the" term');
        degradedMode = true;
        return paginatedSearch(sb, stateRef, label, laneKey, recencyMin, tweetBudget, options);
      }
      if (qi === queries.length - 1) throw e;
    }
  }

  if (started && queryUsed) {
    await runTopPass(queryUsed);
  }

  if (stopReason && started) {
    console.warn(`[ingest] ${label} pagination stopped — ${stopReason} (pages=${pages}, tweets=${tweetsBilled})`);
  }

  const laneStats = {
    reads: tweetsProcessed,
    tweetsBilled,
    returned, rawFromApi, ingested, skippedViews, skippedStale, ingestAgesMin,
    baseFloor: base,
    effectiveFloor: effective,
    floor: effective,
    pages, apiCalls, queryUsed, mode, laneKey, stopReason,
    latestRaw,
    topRaw,
    topPassUnique,
    topPassDuplicates,
  };

  if (!started && apiCalls === 0) {
    return {
      ...laneStats,
      reads: 0, tweetsBilled: 0, returned: 0, rawFromApi: 0, ingested: 0,
      skippedViews: 0, skippedStale: 0, ingestAgesMin: [],
      pages: 0, apiCalls: 0, queryUsed: null,
    };
  }

  if (!started) throw new Error('no query succeeded');

  return laneStats;
}

async function runCycle(sb, opts = {}) {
  const once = !!opts.once;
  logRequestUrlThisCycle = false;

  if (!selfTestDone) {
    selfTestDone = true;
    await runIngestSelfTest();
  }

  let state = once ? await loadState(sb) : await waitIfSpendBlocked(sb);
  if (isSpendBlocked(state)) {
    if (once) {
      console.log(
        `[ingest] dormant — today ${(state.reads_today || 0).toLocaleString()}/${BUDGET.DAILY_TWEET_BUDGET.toLocaleString()} tweets ` +
        `(hour ${(state.hourly_tweets || 0).toLocaleString()}/${BUDGET.MAX_TWEETS_PER_HOUR.toLocaleString()}) — skipping cycle`,
      );
    }
    return { dormant: true };
  }

  const stateRef = { current: state };
  const tweetBudget = cycleBudget('ingest', CONFIG.CATCH_ALL_EVERY_MS);
  const started = Date.now();
  let totalTweetsBilled = 0;
  let totalApiCalls = 0;
  let totalReads = 0;
  let totalReturned = 0;
  let totalRawFromApi = 0;
  let totalIngested = 0;
  let totalSkippedViews = 0;
  let totalSkippedStale = 0;
  let maxPagesSeen = 0;
  let nearMissReads = 0;
  let nearMissPromoted = 0;
  let catchAllResult = null;
  let mediaResult = null;
  let slowBurnResult = null;
  const cycleIngestAges = [];

  const now = Date.now();
  const runCatchAll = once || now - lastCatchAll >= CONFIG.CATCH_ALL_EVERY_MS;

  if (runCatchAll) {
    lastCatchAll = now;
    const lanePct = mediaLanePct(state);
    const textBudget = Math.max(1, Math.floor(tweetBudget * (1 - lanePct)));
    const mediaBudget = Math.max(0, tweetBudget - textBudget);

    logQueryUrlDiff(stateRef.current, 'catch-all', CONFIG.RECENCY_MIN);

    const catchAll = await paginatedSearch(
      sb, stateRef, 'catch-all', 'catch-all', CONFIG.RECENCY_MIN, textBudget,
    );
    state = stateRef.current;
    catchAllResult = catchAll;
    totalReads += catchAll.reads;
    totalTweetsBilled += catchAll.tweetsBilled || 0;
    totalApiCalls += catchAll.apiCalls || 0;
    totalReturned += catchAll.returned;
    totalRawFromApi += catchAll.rawFromApi;
    totalIngested += catchAll.ingested;
    totalSkippedViews += catchAll.skippedViews;
    totalSkippedStale += catchAll.skippedStale || 0;
    maxPagesSeen = Math.max(maxPagesSeen, catchAll.pages);
    if (catchAll.ingestAgesMin?.length) cycleIngestAges.push(...catchAll.ingestAgesMin);

    logIngestLane('catch-all', catchAll);

    if (mediaBudget > 0) {
      const media = await paginatedSearch(
        sb, stateRef, 'media-lane', 'media-lane', CONFIG.RECENCY_MIN, mediaBudget,
        { buildQueryFn: buildMediaQueries },
      );
      state = stateRef.current;
      mediaResult = media;
      totalReads += media.reads;
      totalTweetsBilled += media.tweetsBilled || 0;
      totalApiCalls += media.apiCalls || 0;
      totalReturned += media.returned;
      totalRawFromApi += media.rawFromApi;
      totalIngested += media.ingested;
      totalSkippedViews += media.skippedViews;
      totalSkippedStale += media.skippedStale || 0;
      maxPagesSeen = Math.max(maxPagesSeen, media.pages);
      if (media.ingestAgesMin?.length) cycleIngestAges.push(...media.ingestAgesMin);

      logIngestLane('media-lane', media);
    }
  } else {
    console.log(`[ingest] catch-all skipped — next in ${Math.ceil((CONFIG.CATCH_ALL_EVERY_MS - (now - lastCatchAll)) / 60000)}m`);
  }

  if (now - lastSlowBurn >= CONFIG.SLOW_BURN_EVERY_MS) {
    lastSlowBurn = now;
    const remaining = Math.max(0, tweetBudget - totalTweetsBilled);
    if (remaining > 0 && !isSpendBlocked(stateRef.current)) {
      const slow = await paginatedSearch(
        sb, stateRef, 'slow-burn', 'slow-burn', CONFIG.SLOW_BURN_RECENCY_MIN, remaining,
      );
      state = stateRef.current;
      slowBurnResult = slow;
      totalReads += slow.reads;
      totalTweetsBilled += slow.tweetsBilled || 0;
      totalApiCalls += slow.apiCalls || 0;
      totalReturned += slow.returned;
      totalRawFromApi += slow.rawFromApi;
      totalIngested += slow.ingested;
      totalSkippedViews += slow.skippedViews;
      totalSkippedStale += slow.skippedStale || 0;
      maxPagesSeen = Math.max(maxPagesSeen, slow.pages);
      if (slow.ingestAgesMin?.length) cycleIngestAges.push(...slow.ingestAgesMin);
      logIngestLane('slow-burn', slow);
    }
  }

  if (now - lastNearMiss >= CONFIG.NEAR_MISS_EVERY_MS) {
    lastNearMiss = now;
    const nmGate = await assertCanRequestPage(sb, stateRef.current);
    stateRef.current = nmGate.state || stateRef.current;
    if (nmGate.ok) {
      const { promoted, reads: nmProcessed, tweetsBilled: nmTweets, apiCalls: nmCalls, droppedStale: nmStale, ingestAgesMin: nmAges } =
        await recheckNearMisses(sb, CONFIG.MIN_INGEST_VIEWS, CONFIG.MAX_POST_AGE_MIN_X, upsertIngestedPost, {
          billReads: async (tweets) => {
            stateRef.current = await recordReads(sb, tweets, 'ingest-near-miss');
          },
        });
      state = stateRef.current;
      totalReads += nmProcessed;
      totalTweetsBilled += nmTweets || 0;
      totalApiCalls += nmCalls || 0;
      nearMissReads = nmTweets || 0;
      nearMissPromoted = promoted;
      totalSkippedStale += nmStale || 0;
      if (nmAges?.length) cycleIngestAges.push(...nmAges);
      if (promoted || nmTweets) {
        logIngestLane('near-miss', {
          reads: nmProcessed,
          rawFromApi: nmTweets,
          ingested: promoted,
          skippedViews: Math.max(0, nmTweets - promoted),
          skippedStale: nmStale || 0,
          pages: 1,
          apiCalls: nmCalls || 0,
          floor: 'n/a',
          mode: 'near-miss',
        });
      }
    }
  }

  state = stateRef.current;
  const cycleBudgetMeta = buildBudgetMeta(state, totalTweetsBilled, totalApiCalls);

  const laneResults = [catchAllResult, mediaResult, slowBurnResult].filter(Boolean);
  const anyLaneZero = laneResults.some(r => (r.rawFromApi || 0) === 0);
  const cycleCtx = { anyLaneZero };

  if (catchAllResult && runCatchAll) {
    const textBudget = Math.max(1, Math.floor(tweetBudget * (1 - mediaLanePct(state))));
    ({ state } = await adjustLaneFloor(sb, state, 'catch-all', catchAllResult, textBudget, cycleCtx));
  }
  if (mediaResult && runCatchAll) {
    const lanePct = mediaLanePct(state);
    const mediaBudget = Math.max(0, tweetBudget - Math.max(1, Math.floor(tweetBudget * (1 - lanePct))));
    ({ state } = await adjustLaneFloor(sb, state, 'media-lane', mediaResult, mediaBudget, cycleCtx));
  }
  if (slowBurnResult) {
    ({ state } = await adjustLaneFloor(sb, state, 'slow-burn', slowBurnResult, tweetBudget, cycleCtx));
  }

  state = await maybeDecayFloorsForUnderutilisation(sb, state);
  state = await checkIngestHealthAlarm(sb, state);

  if (runCatchAll) {
    await adjustMediaLaneBudget(sb, state);
    state = await loadState(sb);
  }

  const keptRatio = totalRawFromApi > 0
    ? (((totalRawFromApi - totalSkippedViews) / totalRawFromApi) * 100).toFixed(1)
    : '0.0';

  console.log(
    `[ingest] ${formatRecencyLog(
      { returned: totalReturned, droppedStale: totalSkippedStale, ingested: totalIngested, ingestAgesMin: cycleIngestAges },
      'x',
    )} (max_age=${CONFIG.MAX_POST_AGE_MIN_X}m)`,
  );
  console.log(
    `[ingest] cycle done ${Date.now() - started}ms — ingested ${totalIngested}, ` +
    `view filter kept ${keptRatio}% (${totalIngested}/${totalRawFromApi || totalReturned}), ` +
    `dropped_stale=${totalSkippedStale}` +
    (isWarn(state) ? ' ⚠ budget ≥80%' : '') +
    (!runCatchAll ? ' (catch-all skipped)' : ''),
  );

  const floors = getLaneFloors(state);
  logIngestCycleSummary({
    totalReads: totalTweetsBilled,
    totalApiCalls,
    readBudget: tweetBudget,
    readsToday: state.reads_today,
    dailyTweetBudget: BUDGET.DAILY_TWEET_BUDGET,
    totalRawFromApi,
    totalIngested,
    totalSkippedViews,
    totalSkippedStale,
    floorCatchAll: floors['catch-all'],
    floorSlowBurn: floors['slow-burn'],
    floorMedia: floors['media-lane'],
    floorMin: state.floor_min,
    floorMax: BUDGET.FLOOR_MAX,
    degradedMode,
    minIngestViews: CONFIG.MIN_INGEST_VIEWS,
    nearMissReads,
    nearMissPromoted,
    maxPagesSeen,
    anyLaneZero,
  });

  console.log(`[ingest] ${formatBudgetLine(totalTweetsBilled, state.reads_today, cycleBudgetMeta)}`);

  await logCycle(sb, 'ingest', {
    ingested: totalIngested,
    skipped_floor: totalSkippedViews,
    reads_consumed: totalTweetsBilled,
    adaptive_floor: state.adaptive_floor,
    budget_note: formatBudgetLine(totalTweetsBilled, state.reads_today, cycleBudgetMeta),
  });

  if (totalIngested > 0) {
    await recordPostsIngested(sb, 'x', totalIngested).catch(e => {
      console.warn('[ingest] posts_ingested sync failed:', e.message);
    });
  }

  return { totalIngested, totalReads: totalTweetsBilled, totalApiCalls, state };
}

async function main() {
  loadEnvLocal();
  assertXBudgetConfig();
  const once = process.argv.includes('--once');
  const sb = getServiceClient();
  console.log(
    `[ingest] catch-all every ${CONFIG.CATCH_ALL_EVERY_MS / 60000}m, poll ${CONFIG.POLL_MS / 60000}m, ` +
    `query primary=${CONFIG.QUERY_TYPE_PRIMARY} fallback=${CONFIG.QUERY_TYPE_FALLBACK} top_pass=${CONFIG.ENABLE_TOP_PASS}, media-lane ~${Math.round(BUDGET.MEDIA_LANE_PCT_DEFAULT * 100)}% discovery reads, ` +
    `recency ${CONFIG.RECENCY_MIN}m, max_post_age_x ${CONFIG.MAX_POST_AGE_MIN_X}m, ` +
    `near-miss every ${CONFIG.NEAR_MISS_EVERY_MS / 60000}m, MIN_INGEST_VIEWS=${CONFIG.MIN_INGEST_VIEWS}, ` +
    `daily tweet budget ${BUDGET.DAILY_TWEET_BUDGET.toLocaleString()} tweets ` +
    `(~$${(BUDGET.DAILY_TWEET_BUDGET * BUDGET.COST_PER_TWEET).toFixed(2)} at $${BUDGET.COST_PER_TWEET}/tweet), ` +
    `max ${BUDGET.MAX_PAGES_PER_LANE} pages/lane, hourly cap ${BUDGET.MAX_TWEETS_PER_HOUR.toLocaleString()} tweets (DAILY/12)`,
  );

  if (once) {
    await runCycle(sb, { once: true });
    return;
  }

  for (;;) {
    try {
      await runCycle(sb);
    } catch (e) {
      console.error('[ingest] cycle error:', e.message);
    }
    await sleep(CONFIG.POLL_MS);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { runCycle, runIngestSelfTest, CONFIG };
