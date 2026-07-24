#!/usr/bin/env node
'use strict';

/**
 * TikTok ingest — confirmation lane (X subjects) + topic hashtags.
 * Avoids spam tags (#fyp, #viral). Platform adapter → narrative_posts.
 * Run: node worker/ingest-tiktok.js
 */

const { getServiceClient } = require('./lib/supabase');
const { fetchHashtagVideos, fetchSearchVideos } = require('./lib/tiktok-reader');
const { parseTikTokPost } = require('./lib/parse-tiktok-post');
const { insertPostSnapshot } = require('./lib/snapshots');
const { upsertIngestedPost } = require('./lib/ingest-upsert');
const { logCycle } = require('./lib/cycle-log');
const { FunnelLog } = require('./lib/funnel-log');
const {
  CONFIG: TT_BUDGET,
  loadUsage,
  recordUsage,
  isDormant,
  isWarn,
  canSpend,
  cycleReadBudget,
  formatBudgetLine,
  msUntilUtcMidnight,
  maxReadsPerDay,
} = require('./lib/tiktok-budget');
const { sleep } = require('./lib/retry');
const { loadEnvLocal } = require('./lib/env');
const { isTikTokEnabled } = require('./lib/tiktok-enabled');
const {
  loadUsage: loadApifyUsage,
  isDormant: isApifyDormant,
  logDormantAlarm,
  CONFIG: APIFY_BUDGET,
} = require('./lib/apify-budget');
const { recordPostsIngested } = require('./lib/budget');
const {
  isPostWithinMaxAge,
  trackIngestAge,
  formatRecencyLog,
} = require('./lib/posted-at');

const CONFIG = {
  POLL_MS: TT_BUDGET.POLL_MS,
  MIN_INGEST_VIEWS_TT: Number(process.env.MIN_INGEST_VIEWS_TT) || 100_000,
  MAX_POST_AGE_MIN_TT: Number(process.env.MAX_POST_AGE_MIN_TT) || 1440,
  STALE_WARN_PCT: Number(process.env.TT_STALE_WARN_PCT) || 0.5,
  /** Topic hashtags only — no #fyp / #viral / #foryou (spam-saturated). */
  TOPIC_HASHTAGS: [
    'meme', 'memes', 'brainrot', 'skibidi', 'sigma', 'npc', 'rizz',
    'crypto', 'solana', 'ai', 'storytime', 'pov', 'capcut', 'tiktokmademebuyit',
  ],
  RESULTS_PER_HASHTAG: Number(process.env.TIKTOK_RESULTS_PER_HASHTAG) || 30,
  CONFIRMATION_QUERIES: Number(process.env.TT_CONFIRMATION_QUERIES) || 5,
  CONFIRMATION_BUDGET_PCT: Number(process.env.TT_CONFIRMATION_BUDGET_PCT) || 0.6,
};

const { loadTtHashtagCursor, saveTtHashtagCursor } = require('./lib/cron-state');

let hashtagCursor = 0;
const DISABLED_LOG_MS = 60 * 60 * 1000;
let lastDisabledLogAt = 0;

function maybeLogTikTokDisabled() {
  const now = Date.now();
  if (now - lastDisabledLogAt < DISABLED_LOG_MS) return;
  lastDisabledLogAt = now;
  console.log('[ingest-tiktok] tiktok lane disabled (TIKTOK_ENABLED=false)');
}

function engagementFromParsed(parsed) {
  const { engagementFromTikTokRaw } = require('./lib/parse-tiktok-post');
  return engagementFromTikTokRaw(parsed.raw);
}

function pickHashtagBatch(maxTags) {
  const tags = CONFIG.TOPIC_HASHTAGS;
  const batch = [];
  for (let i = 0; i < maxTags; i += 1) {
    batch.push(tags[(hashtagCursor + i) % tags.length]);
  }
  hashtagCursor = (hashtagCursor + maxTags) % tags.length;
  return batch;
}

async function loadXConfirmationQueries(sb, limit = CONFIG.CONFIRMATION_QUERIES) {
  const { data, error } = await sb
    .from('narratives')
    .select(`
      id, title, trend_term, platforms,
      narrative_posts!narrative_posts_narrative_id_fkey (
        platform,
        post_meme_scores ( suggested_ticker, suggested_name )
      )
    `)
    .eq('source', 'cluster')
    .eq('status', 'open')
    .order('updated_at', { ascending: false })
    .limit(25);

  if (error) {
    console.warn('[ingest-tiktok] confirmation query load:', error.message);
    return [];
  }

  const queries = [];
  for (const n of data || []) {
    const plats = n.platforms || [];
    if (!plats.includes('x')) continue;

    if (n.trend_term) queries.push(String(n.trend_term).trim());
    if (n.title && n.title.length > 4) queries.push(String(n.title).trim());

    for (const p of n.narrative_posts || []) {
      const ms = Array.isArray(p.post_meme_scores) ? p.post_meme_scores[0] : p.post_meme_scores;
      if (ms?.suggested_ticker) queries.push(ms.suggested_ticker.replace(/^\$/, ''));
      if (ms?.suggested_name && ms.suggested_name.length <= 24) queries.push(ms.suggested_name);
    }
  }

  return [...new Set(queries.filter(q => q && q.length >= 3))].slice(0, limit);
}

async function processItems(sb, items, label, stats) {
  const seen = new Set();
  const nowMs = Date.now();
  stats.funnel.in += items.length;

  for (const raw of items) {
    const key = String(raw?.id || raw?.videoId || '');
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);

    try {
      const parsed = parseTikTokPost(raw);
      stats.returned += 1;

      if (!isPostWithinMaxAge(parsed, CONFIG.MAX_POST_AGE_MIN_TT, nowMs)) {
        stats.droppedStale += 1;
        stats.funnel.stale += 1;
        continue;
      }

      if ((parsed.views ?? 0) < CONFIG.MIN_INGEST_VIEWS_TT) {
        stats.skippedViews += 1;
        stats.funnel.views += 1;
        continue;
      }

      const postId = await upsertIngestedPost(sb, parsed, label);
      if (!postId) continue;

      await insertPostSnapshot(sb, postId, engagementFromParsed(parsed));
      stats.ingested += 1;
      stats.funnel.out += 1;
      trackIngestAge(stats, parsed, nowMs);
    } catch (e) {
      console.warn(`[ingest-tiktok] ${label} parse failed:`, e.message);
    }
  }
}

async function runCycle(sb, opts = {}) {
  const once = !!opts.once;
  loadEnvLocal();
  hashtagCursor = await loadTtHashtagCursor(sb);

  if (!isTikTokEnabled()) {
    maybeLogTikTokDisabled();
    return { disabled: true };
  }

  if (!process.env.APIFY_TOKEN) {
    console.warn('[ingest-tiktok] APIFY_TOKEN not set — skipping cycle');
    return { skipped: true };
  }

  let usage = await loadUsage(sb);
  if (isDormant(usage)) {
    const mins = Math.round(msUntilUtcMidnight() / 60_000);
    console.log(`[ingest-tiktok] dormant — TikTok read budget exhausted, sleeping until UTC midnight (~${mins}m)`);
    if (!once) await sleep(msUntilUtcMidnight());
    return { dormant: true };
  }

  const apifyUsage = await loadApifyUsage(sb);
  if (isApifyDormant(apifyUsage)) {
    logDormantAlarm(apifyUsage);
    const mins = Math.round(msUntilUtcMidnight() / 60_000);
    if (!once) await sleep(msUntilUtcMidnight());
    return { dormant: true, reason: 'apify' };
  }

  const readBudget = cycleReadBudget();
  const started = Date.now();
  const stats = {
    returned: 0,
    ingested: 0,
    skippedViews: 0,
    droppedStale: 0,
    reads: 0,
    ingestAgesMin: [],
    funnel: { in: 0, stale: 0, views: 0, out: 0 },
  };

  const confirmBudget = Math.max(1, Math.floor(readBudget * CONFIG.CONFIRMATION_BUDGET_PCT));
  const hashtagBudget = Math.max(0, readBudget - confirmBudget);

  const confirmQueries = await loadXConfirmationQueries(sb);
  if (confirmQueries.length && canSpend(usage, confirmBudget)) {
    try {
      const perQuery = Math.max(3, Math.floor(confirmBudget / confirmQueries.length));
      const search = await fetchSearchVideos(
        confirmQueries,
        perQuery,
        CONFIG.MAX_POST_AGE_MIN_TT,
        { sb },
      );
      stats.reads += search.reads;
      const before = stats.ingested;
      await processItems(sb, search.items, 'x-confirm', stats);
      console.log(
        `[ingest-tiktok] x-confirm [${confirmQueries.join(' | ')}] ` +
        `returned=${search.items.length} ingested=${stats.ingested - before} reads=${search.reads}`,
      );
    } catch (e) {
      console.warn('[ingest-tiktok] x-confirm lane failed:', e.message);
    }
  } else if (!confirmQueries.length) {
    console.log('[ingest-tiktok] x-confirm — no X narrative subjects to search yet');
  }

  usage = await loadUsage(sb);
  const remaining = Math.max(0, readBudget - stats.reads);

  if (hashtagBudget > 0 && remaining > 0 && canSpend(usage, remaining)) {
    const tagCount = Math.min(3, Math.max(1, Math.floor(remaining / CONFIG.RESULTS_PER_HASHTAG)));
    const tags = pickHashtagBatch(tagCount);
    try {
      const hashtag = await fetchHashtagVideos(
        tags,
        CONFIG.RESULTS_PER_HASHTAG,
        CONFIG.MAX_POST_AGE_MIN_TT,
        { sb },
      );
      stats.reads += hashtag.reads;
      const beforeIngest = stats.ingested;
      await processItems(sb, hashtag.items, 'topic-hashtag', stats);
      console.log(
        `[ingest-tiktok] topic-hashtag actor=${hashtag.actor || '?'} [${tags.join(', ')}] ` +
        `returned=${hashtag.items.length} ingested=${stats.ingested - beforeIngest} reads=${hashtag.reads}`,
      );
    } catch (e) {
      console.warn('[ingest-tiktok] topic-hashtag lane failed:', e.message);
    }
  }

  usage = await recordUsage(sb, stats.reads);

  const stalePct = stats.returned > 0 ? stats.droppedStale / stats.returned : 0;
  console.log(`[ingest-tiktok] ${formatRecencyLog(stats, 'tt')} (max_age=${CONFIG.MAX_POST_AGE_MIN_TT}m)`);

  const funnel = new FunnelLog('ingest-tiktok', 'tt')
    .in(stats.funnel.in)
    .drop('stale', stats.funnel.in - stats.funnel.stale)
    .drop('views', stats.funnel.in - stats.funnel.stale - stats.funnel.views)
    .out(stats.funnel.out);
  funnel.log();

  console.log(
    `[ingest-tiktok] cycle done ${Date.now() - started}ms — ` +
    `view_kept=${stats.ingested}/${stats.returned} skipped_views=${stats.skippedViews}` +
    (isWarn(usage) ? ' ⚠ budget ≥80%' : ''),
  );
  if (stats.returned > 0 && stalePct >= CONFIG.STALE_WARN_PCT) {
    console.warn(
      `[ingest-tiktok] ⚠ ${(stalePct * 100).toFixed(0)}% stale after Apify date filter`,
    );
  }
  console.log(`[ingest-tiktok] ${formatBudgetLine(stats.reads, usage)}`);

  await logCycle(sb, 'ingest-tiktok', {
    ingested: stats.ingested,
    skipped_floor: stats.skippedViews,
    reads_consumed: stats.reads,
    budget_note: formatBudgetLine(stats.reads, usage),
  });

  if (stats.ingested > 0) {
    await recordPostsIngested(sb, 'tiktok', stats.ingested).catch(e => {
      console.warn('[ingest-tiktok] posts_ingested sync failed:', e.message);
    });
  }

  await saveTtHashtagCursor(sb, hashtagCursor);
  return { ...stats, usage };
}

async function main() {
  loadEnvLocal();
  const once = process.argv.includes('--once');
  const sb = getServiceClient();

  if (!isTikTokEnabled()) {
    console.log('[ingest-tiktok] TIKTOK_ENABLED=false — lane paused (set TIKTOK_ENABLED=true to re-enable)');
  }

  console.log(
    `[ingest-tiktok] poll ${CONFIG.POLL_MS / 60000}m, MIN_INGEST_VIEWS_TT=${CONFIG.MIN_INGEST_VIEWS_TT}, ` +
    `MAX_POST_AGE_MIN_TT=${CONFIG.MAX_POST_AGE_MIN_TT}, confirmation=${Math.round(CONFIG.CONFIRMATION_BUDGET_PCT * 100)}% budget, ` +
    `tiktok read budget $${TT_BUDGET.TIKTOK_DAILY_BUDGET_USD}/day (~${maxReadsPerDay()} reads), ` +
    `apify hard cap $${APIFY_BUDGET.DAILY_BUDGET_USD}/day`,
  );

  if (once) {
    await runCycle(sb, { once: true });
    return;
  }

  for (;;) {
    try {
      await runCycle(sb);
    } catch (e) {
      console.error('[ingest-tiktok] cycle error:', e.message);
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

module.exports = { runCycle, CONFIG, loadXConfirmationQueries, isTikTokEnabled, maybeLogTikTokDisabled };
