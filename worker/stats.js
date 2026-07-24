#!/usr/bin/env node
'use strict';

/** One-shot pipeline diagnostic. Run: npm run stats */

const { getServiceClient } = require('./lib/supabase');
const { viewsVelocity, missingViewsStats } = require('./lib/velocity');
const { latestCycle } = require('./lib/cycle-log');
const { loadEnvLocal } = require('./lib/env');

const FRESHNESS_MS = 3 * 60 * 60 * 1000;
const MIN_VIEWS_VELOCITY = 200;
const MIN_INGEST_LIKES = 50;
const HEALTH_VELOCITY_PCT = 20;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function fmt(n, digits = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function pct(num, den) {
  if (!den) return '0.0%';
  return ((num / den) * 100).toFixed(1) + '%';
}

function snapshotCount(post) {
  return (post.post_snapshots || []).filter(s => !s.unavailable).length;
}

async function main() {
  loadEnvLocal();
  const sb = getServiceClient();
  const since = new Date(Date.now() - FRESHNESS_MS).toISOString();

  const { data: posts, error: postsErr } = await sb
    .from('narrative_posts')
    .select(`
      id, first_seen_at, tracking_status, likes, views,
      post_snapshots ( captured_at, views, likes, retweets, replies, unavailable )
    `)
    .eq('platform', 'x')
    .not('platform_post_id', 'is', null)
    .gte('first_seen_at', since);

  if (postsErr) throw new Error('posts: ' + postsErr.message);

  const all = posts || [];
  const active = all.filter(p => p.tracking_status === 'active');
  const pruned = all.filter(p => p.tracking_status === 'pruned');
  const with2 = active.filter(p => snapshotCount(p) >= 2);
  const viewsVels = with2.map(p => viewsVelocity(p)).filter(v => v != null);
  const sortedVel = viewsVels.slice().sort((a, b) => a - b);
  const nonZeroVel = viewsVels.filter(v => v > 0).length;
  const aboveGate = viewsVels.filter(v => v >= MIN_VIEWS_VELOCITY).length;
  const velocityHealthPct = with2.length ? (nonZeroVel / with2.length) * 100 : 0;
  const viewStats = missingViewsStats(with2);

  const { count: scoredCount, error: scoredErr } = await sb
    .from('post_meme_scores')
    .select('*', { count: 'exact', head: true });
  if (scoredErr) throw new Error('scored: ' + scoredErr.message);

  const postIdSet = new Set(all.map(p => p.id));
  const { data: scoreRows, error: scoreRowsErr } = await sb
    .from('post_meme_scores')
    .select('post_id');
  if (scoreRowsErr) throw new Error('score rows: ' + scoreRowsErr.message);
  const scoredWindow = (scoreRows || []).filter(s => postIdSet.has(s.post_id)).length;

  const { data: clusters, error: clusterErr } = await sb
    .from('narratives')
    .select('id, status, source, display_eligible, bought_reach, views_velocity')
    .eq('source', 'cluster');
  if (clusterErr) throw new Error('clusters: ' + clusterErr.message);

  const clusterRows = clusters || [];
  const openClusters = clusterRows.filter(c => c.status === 'open').length;
  const displayClusters = clusterRows.filter(c => c.display_eligible).length;

  const lastIngest = await latestCycle(sb, 'ingest');
  const lastSnapshot = await latestCycle(sb, 'snapshotter');

  const { count: prunedAllTime, error: prunedErr } = await sb
    .from('narrative_posts')
    .select('*', { count: 'exact', head: true })
    .eq('tracking_status', 'pruned');
  if (prunedErr) throw new Error('pruned count: ' + prunedErr.message);

  const healthOk = velocityHealthPct >= HEALTH_VELOCITY_PCT;

  console.log('');
  console.log('Insidor worker stats');
  console.log('────────────────────────────────────────');
  console.log(`Freshness window     ${FRESHNESS_MS / 3600000}h (since ${since.slice(0, 19)}Z)`);
  console.log(`MIN_VIEWS_VELOCITY   ${MIN_VIEWS_VELOCITY} views/min`);
  console.log(`MIN_INGEST_LIKES     ${MIN_INGEST_LIKES}`);
  if (viewStats.checked > 0) {
    const line = `viewCount coverage   ${(100 - viewStats.pct).toFixed(1)}% (${viewStats.checked - viewStats.missing}/${viewStats.checked})`;
    console.log(viewStats.pct >= 10 ? `⚠ ${line} — ranking unreliable` : line);
  }
  console.log('');
  console.log('── Ingest (last cycle) ──');
  if (lastIngest) {
    console.log(`  at                 ${lastIngest.ran_at?.slice(0, 19)}Z`);
    console.log(`  ingested           ${lastIngest.ingested ?? 0}`);
    console.log(`  skipped floor      ${lastIngest.skipped_floor ?? 0}`);
  } else {
    console.log('  (no worker_cycle_log rows — run ingest after schema-tracking.sql)');
  }
  console.log('');
  console.log('── Snapshotter (last cycle) ──');
  if (lastSnapshot) {
    console.log(`  at                 ${lastSnapshot.ran_at?.slice(0, 19)}Z`);
    console.log(`  pruned dead        ${lastSnapshot.pruned ?? 0}`);
    console.log(`  snapshots written  ${lastSnapshot.snapshots_written ?? 0}`);
  } else {
    console.log('  (no worker_cycle_log rows yet)');
  }
  console.log('');
  console.log(`Total posts (window) ${all.length} (${active.length} active, ${pruned.length} pruned in window)`);
  console.log(`Pruned (all time)    ${prunedAllTime ?? 0}`);
  console.log(`Posts ≥2 snapshots   ${with2.length} (active only)`);
  console.log(
    `Views velocity       min ${fmt(sortedVel[0])}  p50 ${fmt(percentile(sortedVel, 0.5))}  ` +
    `p90 ${fmt(percentile(sortedVel, 0.9))}  max ${fmt(sortedVel[sortedVel.length - 1])} views/min`,
  );
  console.log(`Above MIN gate       ${aboveGate} / ${viewsVels.length}`);
  console.log(
    `Velocity health      ${pct(nonZeroVel, with2.length)} with non-zero views velocity` +
    (with2.length ? ` — target ≥${HEALTH_VELOCITY_PCT}%` : '') +
    (with2.length ? (healthOk ? ' ✓' : ' ⚠ ingest may still be pulling junk') : ''),
  );
  console.log('');
  console.log(`Scored posts (all)   ${scoredCount ?? 0}`);
  console.log(`Scored in window     ${scoredWindow ?? 0}`);
  console.log('');
  console.log(
    `Clusters (cluster)   ${clusterRows.length} total, ${openClusters} open, ` +
    `${displayClusters} display_eligible`,
  );
  console.log('────────────────────────────────────────');
  console.log('');
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
