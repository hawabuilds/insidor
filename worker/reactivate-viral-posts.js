#!/usr/bin/env node
'use strict';

/**
 * One-time / manual: restore pruned posts that qualify for the live viral feed.
 * Run: node worker/reactivate-viral-posts.js
 */

const { getServiceClient } = require('./lib/supabase');
const { loadEnvLocal } = require('./lib/env');

const MIN_FEED_VIEWS = Number(process.env.MIN_INGEST_VIEWS) || 30_000;

async function main() {
  loadEnvLocal();
  const sb = getServiceClient();

  const { count: beforeCount, error: countErr } = await sb
    .from('narrative_posts')
    .select('id', { count: 'exact', head: true })
    .eq('tracking_status', 'active')
    .gte('views', MIN_FEED_VIEWS)
    .in('platform', ['x', 'tt']);

  if (countErr) throw new Error(countErr.message);

  const { data: updated, error: upErr } = await sb
    .from('narrative_posts')
    .update({ tracking_status: 'active', pruned_at: null })
    .eq('tracking_status', 'pruned')
    .gte('views', MIN_FEED_VIEWS)
    .in('platform', ['x', 'tt'])
    .select('id');

  if (upErr) throw new Error(upErr.message);

  const { count: after, error: afterErr } = await sb
    .from('narrative_posts')
    .select('id', { count: 'exact', head: true })
    .eq('tracking_status', 'active')
    .gte('views', MIN_FEED_VIEWS)
    .in('platform', ['x', 'tt']);

  if (afterErr) throw new Error(afterErr.message);

  console.log(
    `[reactivate] restored ${updated?.length ?? 0} posts (≥${MIN_FEED_VIEWS} views, x/tt)`,
  );
  console.log(`[reactivate] viral-feed active: ${beforeCount ?? 0} → ${after ?? 0}`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
