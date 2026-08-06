'use strict';

function pct(num, den) {
  if (!den) return '0.0';
  return ((num / den) * 100).toFixed(1);
}

function logIngestLane(label, stats) {
  const kept = pct(stats.ingested, stats.rawFromApi || stats.returned);
  const floorStr = stats.baseFloor != null
    ? `base_floor=${stats.baseFloor} effective_floor=${stats.effectiveFloor ?? stats.floor}`
    : `floor=${stats.floor}`;
  const qtParts = [];
  if (stats.latestRaw != null) qtParts.push(`Latest_raw=${stats.latestRaw}`);
  if (stats.topRaw != null) qtParts.push(`Top_raw=${stats.topRaw}`);
  const qtStr = qtParts.length ? ` ${qtParts.join(' ')}` : '';
  const topPassStr = stats.topPassUnique != null
    ? ` top_pass_unique=${stats.topPassUnique} top_pass_dupes=${stats.topPassDuplicates ?? 0}`
    : '';
  console.log(
    `[ingest] funnel ${label}: reads=${stats.reads} api_raw=${stats.rawFromApi ?? stats.returned}${qtStr}${topPassStr} ` +
    `stored=${stats.ingested} dropped_views=${stats.skippedViews} dropped_stale=${stats.skippedStale} ` +
    `pages=${stats.pages} api_calls=${stats.apiCalls ?? 1} ` +
    `${floorStr} mode=${stats.mode} kept=${kept}%` +
    (stats.queryUsed
      ? ` query="${String(stats.queryUsed).length > 72 ? `${String(stats.queryUsed).slice(0, 72)}…` : stats.queryUsed}"`
      : ''),
  );
}

function logIngestCycleSummary(ctx) {
  const {
    totalReads,
    totalApiCalls,
    readBudget,
    readsToday,
    dailyTweetBudget,
    totalRawFromApi,
    totalIngested,
    totalSkippedViews,
    totalSkippedStale,
    floorCatchAll,
    floorSlowBurn,
    floorMedia,
    floorMin,
    floorMax,
    degradedMode,
    minIngestViews,
    nearMissReads,
    nearMissPromoted,
    anyLaneZero,
  } = ctx;

  const budgetPct = pct(readsToday, dailyTweetBudget);
  const cyclePct = pct(totalReads, readBudget);
  const viewKept = pct(totalIngested, totalRawFromApi);

  console.log(
    `[ingest] funnel cycle: api_calls=${totalApiCalls || 0} tweets=${totalReads}/${readBudget} this cycle (${cyclePct}% of cycle cap) · ` +
    `today ${readsToday.toLocaleString()}/${dailyTweetBudget.toLocaleString()} tweets (${budgetPct}% of DAILY_TWEET_BUDGET) · ` +
    `api_raw=${totalRawFromApi} stored=${totalIngested} dropped_views=${totalSkippedViews} ` +
    `dropped_stale=${totalSkippedStale} view_kept=${viewKept}%` +
    (anyLaneZero ? ' · lane_zero=true' : ''),
  );
  console.log(
    `[ingest] funnel floors: catch-all=${floorCatchAll} slow-burn=${floorSlowBurn} media=${floorMedia} ` +
    `floor_min=${floorMin} FLOOR_MAX=${floorMax} degraded_mode=${degradedMode} ` +
    `MIN_INGEST_VIEWS=${minIngestViews.toLocaleString()}` +
    (nearMissReads ? ` · near_miss reads=${nearMissReads} promoted=${nearMissPromoted}` : ''),
  );

  const causes = diagnoseIngestBottlenecks(ctx);
  if (causes.length) {
    console.warn(`[ingest] funnel diagnosis: ${causes.join(' · ')}`);
  }
}

/**
 * Ordered checks matching likely causes list.
 */
function diagnoseIngestBottlenecks(ctx) {
  const causes = [];
  const {
    floorCatchAll,
    floorSlowBurn,
    floorMedia,
    floorMin,
    floorMax,
    degradedMode,
    totalRawFromApi,
    totalIngested,
    totalSkippedViews,
    readsToday,
    dailyTweetBudget,
    maxPagesSeen,
    minIngestViews,
    anyLaneZero,
  } = ctx;

  const maxLane = Math.max(floorCatchAll || 0, floorSlowBurn || 0, floorMedia || 0);
  if (floorMin >= floorMax * 0.8 || maxLane >= floorMax * 0.8) {
    causes.push(`(1) lane floor near FLOOR_MAX (max=${maxLane}, floor_min=${floorMin})`);
  } else if (maxLane >= 2000 || floorMin >= 2000) {
    causes.push(
      `(1) lane floor very high (catch-all=${floorCatchAll}, slow=${floorSlowBurn}, media=${floorMedia}) — ` +
      'likely zero API hits in 30m window',
    );
  } else if (anyLaneZero && floorCatchAll > 500) {
    causes.push(
      `(1) lane returned api_raw=0 — check queryType Latest/Top split or floor too high (catch-all base=${floorCatchAll})`,
    );
  }

  if (degradedMode) {
    causes.push('(2) DEGRADED MODE active — keyword-free query fell back to "the" term');
  }

  if (maxPagesSeen <= 1 && totalRawFromApi > 0) {
    causes.push(`(3) pagination stopped at page ${maxPagesSeen} (may not exhaust recency window)`);
  }

  if (totalRawFromApi > 0) {
    const dropPct = totalSkippedViews / totalRawFromApi;
    if (dropPct >= 0.8) {
      causes.push(
        `(4) MIN_INGEST_VIEWS=${minIngestViews.toLocaleString()} discards ${(dropPct * 100).toFixed(0)}% of api_raw`,
      );
    }
  } else if (totalIngested === 0) {
    causes.push('(4) no api_raw this cycle — views filter irrelevant until API returns posts');
  }

  if (readsToday < dailyTweetBudget * 0.15) {
    causes.push(
      `(5) daily tweets barely spent (${pct(readsToday, dailyTweetBudget)}% of ${dailyTweetBudget.toLocaleString()})`,
    );
  }

  return causes;
}

module.exports = {
  logIngestLane,
  logIngestCycleSummary,
  diagnoseIngestBottlenecks,
  pct,
};
