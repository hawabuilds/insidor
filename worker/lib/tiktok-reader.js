'use strict';

const APIFY_BASE = 'https://api.apify.com/v2';
const {
  loadUsage: loadApifyUsage,
  recordRun: recordApifyRun,
  isDormant: isApifyDormant,
  canSpend: canApifySpend,
  costForRun,
  estimateInputItems,
  logDormantAlarm,
} = require('./apify-budget');

const ACTORS = {
  discover: 'clockworks/tiktok-discover-scraper',
  hashtag: 'clockworks/tiktok-hashtag-scraper',
  /** Supports oldestPostDateUnified on hashtag/discover queries — prefer over hashtag-only scraper. */
  scraper: 'clockworks/tiktok-scraper',
  video: 'clockworks/tiktok-video-scraper',
};

function actorPath(actorId) {
  return actorId.replace('/', '~');
}

function getToken() {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN not set');
  return token;
}

async function runActorSync(actorId, input, opts = {}) {
  const { sb } = opts;
  const estItems = estimateInputItems(input);
  const estCost = costForRun(estItems, 1);

  if (sb) {
    const usage = await loadApifyUsage(sb);
    if (isApifyDormant(usage)) {
      logDormantAlarm(usage);
      throw new Error('Apify daily budget exhausted');
    }
    if (!canApifySpend(usage, estCost)) {
      throw new Error(
        `Apify run would exceed daily budget (est ~$${estCost.toFixed(3)}, ` +
        `spent ~$${Number(usage.cost_usd || 0).toFixed(2)})`,
      );
    }
  }

  const token = getToken();
  const timeout = opts.timeoutSec || 300;
  const url =
    `${APIFY_BASE}/acts/${actorPath(actorId)}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(token)}&timeout=${timeout}&format=json&clean=true`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Apify ${actorId} HTTP ${res.status}: ${body.slice(0, 240)}`);
  }

  const items = await res.json();
  const list = Array.isArray(items) ? items : [];
  const reads = Math.max(1, list.length);

  if (sb) {
    await recordApifyRun(sb, { actorId, itemCount: list.length, runs: 1 });
  }

  return { items: list, reads, actorId };
}

function apifyInputBase() {
  return {
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSlideshowImages: false,
    shouldDownloadSubtitles: false,
  };
}

/** ISO date for Apify oldestPostDateUnified (tiktok-scraper). */
function oldestPostDateIso(maxAgeMin) {
  const ms = Math.max(1, Number(maxAgeMin) || 1440) * 60 * 1000;
  return new Date(Date.now() - ms).toISOString().slice(0, 10);
}

/**
 * Discover lane — tiktok-scraper with date floor when maxAgeMin set (saves Apify cost).
 * Falls back to discover-scraper (no date filter) on failure.
 */
async function fetchDiscoverVideos(hashtags, resultsPerPage, maxAgeMin, opts = {}) {
  if (maxAgeMin) {
    try {
      const { items, reads } = await runActorSync(ACTORS.scraper, {
        ...apifyInputBase(),
        hashtags,
        resultsPerPage,
        oldestPostDateUnified: oldestPostDateIso(maxAgeMin),
      }, opts);
      return { items, reads, source: 'discover-dated', actor: ACTORS.scraper };
    } catch (e) {
      console.warn('[tiktok-reader] dated discover via tiktok-scraper failed:', e.message);
    }
  }

  const { items, reads } = await runActorSync(ACTORS.discover, {
    ...apifyInputBase(),
    hashtags,
    resultsPerPage,
  }, opts);
  return { items, reads, source: 'discover', actor: ACTORS.discover };
}

/**
 * Hashtag lane — prefer tiktok-scraper + oldestPostDateUnified (date range at source).
 * clockworks/tiktok-hashtag-scraper has no recent-sort; code filter still applies as backstop.
 */
async function fetchHashtagVideos(hashtags, resultsPerPage, maxAgeMin, opts = {}) {
  if (maxAgeMin) {
    try {
      const { items, reads } = await runActorSync(ACTORS.scraper, {
        ...apifyInputBase(),
        hashtags,
        resultsPerPage,
        oldestPostDateUnified: oldestPostDateIso(maxAgeMin),
      }, opts);
      return { items, reads, source: 'hashtag-dated', actor: ACTORS.scraper };
    } catch (e) {
      console.warn('[tiktok-reader] dated hashtag via tiktok-scraper failed:', e.message);
    }
  }

  const { items, reads } = await runActorSync(ACTORS.hashtag, {
    ...apifyInputBase(),
    hashtags,
    resultsPerPage,
  }, opts);
  return { items, reads, source: 'hashtag', actor: ACTORS.hashtag };
}

async function fetchSearchVideos(queries, resultsPerPage, maxAgeMin, opts = {}) {
  const q = (queries || []).filter(Boolean).slice(0, 5);
  if (!q.length) return { items: [], reads: 0, source: 'search', actor: ACTORS.scraper };

  const { items, reads } = await runActorSync(ACTORS.scraper, {
    ...apifyInputBase(),
    searchQueries: q,
    resultsPerPage: resultsPerPage || 20,
    ...(maxAgeMin ? { oldestPostDateUnified: oldestPostDateIso(maxAgeMin) } : {}),
  }, opts);
  return { items, reads, source: 'search', actor: ACTORS.scraper };
}

/** Refresh metrics for known videos (snapshotter). */
async function getTikTokVideosByUrls(urls, opts = {}) {
  const clean = (urls || []).filter(Boolean);
  if (!clean.length) return { items: [], reads: 0 };

  const { items, reads } = await runActorSync(ACTORS.video, {
    ...apifyInputBase(),
    postURLs: clean,
  }, { ...opts, timeoutSec: opts.timeoutSec || 120 });

  return { items, reads };
}

module.exports = {
  ACTORS,
  runActorSync,
  oldestPostDateIso,
  fetchDiscoverVideos,
  fetchHashtagVideos,
  fetchSearchVideos,
  getTikTokVideosByUrls,
};
