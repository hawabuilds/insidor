#!/usr/bin/env node
'use strict';

/**
 * Tiered snapshotter — budget at 40% of daily reads.
 * HOT 20% vv → 2m | WARM 40% → 8m | COLD → 20m
 * Prune cold only when vv is known and low — never prune viral-feed posts (≥30k views).
 * Run: node worker/snapshotter.js
 */

const { getServiceClient } = require('./lib/supabase');
const { getTweetsByIds, tweetsInResponse } = require('./lib/x-reader');
const { getTikTokVideosByUrls } = require('./lib/tiktok-reader');
const { engagementFromRaw, mediaFromRaw } = require('./lib/parse-raw-post');
const { engagementFromTikTokRaw, tiktokVideoUrl } = require('./lib/parse-tiktok-post');
const { insertPostSnapshot } = require('./lib/snapshots');
const { viewsVelocity } = require('./lib/velocity');
const { logCycle } = require('./lib/cycle-log');
const {
  CONFIG: BUDGET,
  loadState,
  recordReads,
  waitIfSpendBlocked,
  assertCanRequestPage,
  isSpendBlocked,
  canAffordPage,
  cycleBudget,
  formatBudgetLine,
  buildBudgetMeta,
  msUntilUtcMidnight,
  assertXBudgetConfig,
} = require('./lib/budget');
const { recordUsage: recordTikTokUsage, loadUsage: loadTikTokUsage, canSpend: canSpendTikTok } = require('./lib/tiktok-budget');
const {
  loadUsage: loadApifyUsage,
  isDormant: isApifyDormant,
  logDormantAlarm,
} = require('./lib/apify-budget');
const { isTikTokEnabled } = require('./lib/tiktok-enabled');
const { sleep } = require('./lib/retry');
const { loadEnvLocal } = require('./lib/env');
const {
  analyzePosts,
  setDiagnosticResult,
  logDiagnostic,
} = require('./lib/tt-view-diagnostic');

const MIN_FEED_VIEWS = Number(process.env.MIN_INGEST_VIEWS) || 30_000;
const MIN_FEED_VIEWS_TT = Number(process.env.MIN_INGEST_VIEWS_TT) || 100_000;
const SNAPSHOT_TT_MULTIPLIER = Number(process.env.SNAPSHOT_TT_MULTIPLIER) || 3;

const CONFIG = {
  POLL_MS: BUDGET.SNAPSHOT_POLL_MS,
  WINDOW_MS: 3 * 60 * 60 * 1000,
  BATCH_SIZE: 50,
  HOT_INTERVAL_MS: 2 * 60_000,
  WARM_INTERVAL_MS: 8 * 60_000,
  COLD_INTERVAL_MS: 20 * 60_000,
  COLD_PRUNE_VV: 500,
  COLD_PRUNE_AFTER_MS: 10 * 60 * 1000,
};

function latestPostViews(post) {
  if (post.views != null && Number(post.views) > 0) return Number(post.views);
  const snaps = (post.post_snapshots || [])
    .filter(s => !s.unavailable && s.views != null)
    .sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
  return snaps[0]?.views != null ? Number(snaps[0].views) : 0;
}

const TIER_INTERVAL = {
  hot: CONFIG.HOT_INTERVAL_MS,
  warm: CONFIG.WARM_INTERVAL_MS,
  cold: CONFIG.COLD_INTERVAL_MS,
};

function minFeedViews(platform) {
  return platform === 'tt' ? MIN_FEED_VIEWS_TT : MIN_FEED_VIEWS;
}

function tierIntervalMs(post) {
  const tier = post._tier || post.snapshot_tier || 'cold';
  const base = TIER_INTERVAL[tier] || CONFIG.COLD_INTERVAL_MS;
  return post.platform === 'tt' ? base * SNAPSHOT_TT_MULTIPLIER : base;
}

function assignTiers(posts) {
  const ranked = posts
    .map(p => ({ post: p, vv: viewsVelocity(p) ?? 0 }))
    .sort((a, b) => b.vv - a.vv);

  const n = ranked.length;
  const hotCut = Math.max(1, Math.ceil(n * 0.2));
  const warmCut = Math.max(hotCut, Math.ceil(n * 0.6));

  return ranked.map((r, i) => {
    let tier = 'cold';
    if (i < hotCut) tier = 'hot';
    else if (i < warmCut) tier = 'warm';
    return { ...r.post, _vv: r.vv, _tier: tier };
  });
}

function dueForSnapshot(post, nowMs = Date.now()) {
  const interval = tierIntervalMs(post);
  const last = post.last_snapshot_at ? new Date(post.last_snapshot_at).getTime() : 0;
  return !last || nowMs - last >= interval;
}

async function pruneColdDead(sb, posts) {
  const trackCutoff = Date.now() - CONFIG.COLD_PRUNE_AFTER_MS;
  const toPrune = [];

  for (const post of posts) {
    if ((post._tier || post.snapshot_tier) !== 'cold') continue;
    const seen = new Date(post.first_seen_at).getTime();
    if (seen > trackCutoff) continue;
    if (latestPostViews(post) >= minFeedViews(post.platform)) continue;
    const vv = post._vv ?? viewsVelocity(post);
    if (vv == null) continue;
    if (vv < CONFIG.COLD_PRUNE_VV) toPrune.push(post.id);
  }

  if (!toPrune.length) return { count: 0, ids: [] };
  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from('narrative_posts')
    .update({ tracking_status: 'pruned', pruned_at: nowIso })
    .in('id', toPrune);
  if (error) throw new Error('prune cold: ' + error.message);
  return { count: toPrune.length, ids: toPrune };
}

async function loadActivePosts(sb) {
  const since = new Date(Date.now() - CONFIG.WINDOW_MS).toISOString();
  const { data, error } = await sb
    .from('narrative_posts')
    .select(`
      id, platform, platform_post_id, handle, raw, views, first_seen_at, last_snapshot_at, snapshot_tier,
      post_snapshots ( captured_at, views, likes, retweets, replies, unavailable )
    `)
    .in('platform', ['x', 'tt'])
    .eq('tracking_status', 'active')
    .not('platform_post_id', 'is', null)
    .gte('first_seen_at', since);

  if (error) throw new Error('select posts: ' + error.message);
  return data || [];
}

async function snapshotXBatch(sb, posts, stateRef) {
  const ids = posts.map(p => p.platform_post_id);
  let tweetsById = new Map();

  const gate = await assertCanRequestPage(sb, stateRef?.current);
  if (stateRef) stateRef.current = gate.state || stateRef.current;
  if (!gate.ok) {
    return { written: 0, failures: posts.length, reads: 0, apiCalls: 0 };
  }

  try {
    const data = await getTweetsByIds(ids);
    const tweetsBilled = tweetsInResponse(data);
    if (tweetsBilled > 0) {
      const next = await recordReads(sb, tweetsBilled, 'snapshotter');
      if (stateRef) stateRef.current = next;
    }
    for (const t of data.tweets || []) {
      if (t?.id) tweetsById.set(String(t.id), t);
    }
    const batch = await applySnapshotBatch(sb, posts, (post) => {
      const raw = tweetsById.get(String(post.platform_post_id));
      return { raw, eng: engagementFromRaw(raw || null), mediaFn: mediaFromRaw };
    });
    return { ...batch, reads: tweetsBilled, apiCalls: ids.length ? 1 : 0 };
  } catch (e) {
    console.error('[snapshotter] X batch fetch failed:', e.message);
    return { written: 0, failures: posts.length, reads: 0, apiCalls: 0 };
  }
}

async function snapshotTikTokBatch(sb, posts) {
  const urls = posts.map(p => tiktokVideoUrl(p)).filter(Boolean);
  let itemsById = new Map();

  try {
    const { items, reads } = await getTikTokVideosByUrls(urls, { sb });
    for (const item of items || []) {
      const id = String(item?.id || item?.videoId || '');
      if (id) itemsById.set(id, item);
    }
    if (!itemsById.size) {
      return { written: 0, failures: posts.length, reads: reads || urls.length };
    }
  } catch (e) {
    console.error('[snapshotter] TikTok batch fetch failed:', e.message);
    return { written: 0, failures: posts.length, reads: urls.length };
  }

  const batch = await applySnapshotBatch(sb, posts, (post) => {
    const raw = itemsById.get(String(post.platform_post_id));
    const eng = engagementFromTikTokRaw(raw || null);
    return {
      raw,
      eng,
      mediaFn: (r) => {
        const { coverFromRaw } = require('./lib/parse-tiktok-post');
        const cover = coverFromRaw(r);
        return { mediaUrl: cover, mediaType: cover ? 'video' : null };
      },
    };
  });
  return { ...batch, reads: urls.length };
}

async function applySnapshotBatch(sb, posts, resolveRaw) {
  let written = 0;
  let failures = 0;
  const nowIso = new Date().toISOString();

  for (const post of posts) {
    try {
      const { raw, eng, mediaFn } = resolveRaw(post);
      await insertPostSnapshot(sb, post.id, eng);
      const patch = { last_snapshot_at: nowIso, snapshot_tier: post._tier || post.snapshot_tier };
      if (raw && !eng.unavailable) {
        patch.views = eng.views ?? 0;
        patch.replies = eng.replies ?? 0;
        patch.quotes = eng.quotes ?? 0;
        patch.likes = eng.likes ?? 0;
        patch.retweets = eng.retweets ?? 0;
        patch.raw = raw;
        const media = mediaFn(raw);
        if (media?.mediaUrl) {
          patch.media_url = media.mediaUrl;
          patch.media_type = media.mediaType;
        }
      }
      await sb.from('narrative_posts').update(patch).eq('id', post.id);
      written += 1;
    } catch (e) {
      failures += 1;
      console.warn(`[snapshotter] post ${post.platform_post_id}:`, e.message);
    }
  }

  return { written, failures, reads: 0, apiCalls: 0 };
}

async function snapshotBatch(sb, posts, state) {
  const xPosts = posts.filter(p => p.platform === 'x');
  const ttPosts = posts.filter(p => p.platform === 'tt');
  let written = 0;
  let failures = 0;
  let reads = 0;
  let apiCalls = 0;
  let ttReads = 0;

  if (xPosts.length) {
    const x = await snapshotXBatch(sb, xPosts, state);
    written += x.written;
    failures += x.failures;
    reads += x.reads;
    apiCalls += x.apiCalls || 0;
  }
  if (ttPosts.length) {
    const tt = await snapshotTikTokBatch(sb, ttPosts);
    written += tt.written;
    failures += tt.failures;
    ttReads += tt.reads;
  }

  return { written, failures, reads, apiCalls, ttReads };
}

async function runCycle(sb) {
  let state = await waitIfSpendBlocked(sb);
  if (isSpendBlocked(state)) {
    return { dormant: true };
  }

  const stateRef = { current: state };
  const tweetBudget = cycleBudget('snapshotter', CONFIG.POLL_MS);
  let all = assignTiers(await loadActivePosts(sb));
  const { count: pruned, ids: prunedIds } = await pruneColdDead(sb, all);
  const prunedSet = new Set(prunedIds);
  all = all.filter(p => !prunedSet.has(p.id));

  const due = all.filter(p => dueForSnapshot(p));
  const tierCounts = { hot: 0, warm: 0, cold: 0 };
  for (const p of all) tierCounts[p._tier] = (tierCounts[p._tier] || 0) + 1;

  const xDue = due.filter(p => p.platform === 'x');
  const ttDue = due.filter(p => p.platform === 'tt');

  let snapshotsWritten = 0;
  let failures = 0;
  let tweetsBilled = 0;
  let apiCalls = 0;
  let ttReads = 0;

  for (let i = 0; i < xDue.length; i += CONFIG.BATCH_SIZE) {
    state = stateRef.current;
    if (tweetsBilled >= tweetBudget || isSpendBlocked(state)) break;
    if (!canAffordPage(state)) break;

    const chunk = xDue.slice(i, i + CONFIG.BATCH_SIZE).slice(0, Math.max(0, tweetBudget - tweetsBilled));
    if (!chunk.length) break;
    const { written, failures: f, reads: r, apiCalls: c } = await snapshotBatch(sb, chunk, stateRef);
    state = stateRef.current;
    snapshotsWritten += written;
    failures += f;
    tweetsBilled += r;
    apiCalls += c || 0;
  }

  let ttUsage = await loadTikTokUsage(sb);
  const ttEnabled = isTikTokEnabled();
  let apifyUsage = ttEnabled ? await loadApifyUsage(sb) : null;

  for (let i = 0; i < ttDue.length; i += CONFIG.BATCH_SIZE) {
    if (!ttEnabled) break;
    if (apifyUsage && isApifyDormant(apifyUsage)) {
      logDormantAlarm(apifyUsage);
      break;
    }
    const chunk = ttDue.slice(i, i + CONFIG.BATCH_SIZE);
    if (!canSpendTikTok(ttUsage, chunk.length)) break;
    const { written, failures: f, ttReads: tr } = await snapshotBatch(sb, chunk, state);
    snapshotsWritten += written;
    failures += f;
    ttReads += tr || 0;
    if (tr > 0) {
      ttUsage = await recordTikTokUsage(sb, tr);
      apifyUsage = await loadApifyUsage(sb);
    }
  }

  state = stateRef.current;
  const cycleBudgetMeta = buildBudgetMeta(state, tweetsBilled, apiCalls);

  console.log(
    `[snapshotter] tiers hot=${tierCounts.hot} warm=${tierCounts.warm} cold=${tierCounts.cold} | ` +
    `due=${due.length} snapped=${snapshotsWritten} pruned_cold=${pruned} failures=${failures} ` +
    `tweets_x=${tweetsBilled} api_calls_x=${apiCalls} tweets_tt=${ttReads}`,
  );
  console.log(`[snapshotter] ${formatBudgetLine(tweetsBilled, state.reads_today, cycleBudgetMeta)}`);

  await logCycle(sb, 'snapshotter', {
    pruned,
    snapshots_written: snapshotsWritten,
    reads_consumed: tweetsBilled,
    budget_note: formatBudgetLine(tweetsBilled, state.reads_today, cycleBudgetMeta),
  });

  const ttDiag = analyzePosts(all.filter(p => p.platform === 'tt'));
  setDiagnosticResult(ttDiag);
  logDiagnostic(ttDiag, 'snapshotter');

  return { snapshotsWritten, reads: tweetsBilled, apiCalls, pruned };
}

async function main() {
  loadEnvLocal();
  assertXBudgetConfig();
  const once = process.argv.includes('--once');
  const sb = getServiceClient();

  console.log(
    `[snapshotter] tiered — poll ${CONFIG.POLL_MS / 1000}s, HOT 2m / WARM 8m / COLD 20m ` +
    `(TT ×${SNAPSHOT_TT_MULTIPLIER}), cold prune vv<${CONFIG.COLD_PRUNE_VV}/min after ` +
    `${CONFIG.COLD_PRUNE_AFTER_MS / 60000}m (skip X≥${MIN_FEED_VIEWS} / TT≥${MIN_FEED_VIEWS_TT} + unknown vv)`,
  );

  if (once) {
    await runCycle(sb);
    return;
  }

  for (;;) {
    try {
      await runCycle(sb);
    } catch (e) {
      console.error('[snapshotter] cycle error:', e.message);
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

module.exports = { runCycle, CONFIG };
