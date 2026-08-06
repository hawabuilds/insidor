#!/usr/bin/env node
'use strict';

/**
 * Repair stale posts + posted_at units via Supabase service client (no DATABASE_URL needed).
 * Run: node worker/repair-stale.js
 */

const fs = require('fs');
const path = require('path');
const { getServiceClient } = require('./lib/supabase');
const { t, c, cs, row: dbRow, REL } = require('../lib/db-schema');
const { loadEnvLocal } = require('./lib/env');
const { normalizePostedAt } = require('./lib/posted-at');

const MS_24H = 24 * 60 * 60 * 1000;
const MS_12H = 12 * 60 * 60 * 1000;

async function repairPostedAtUnits(sb) {
  let fixedSeconds = 0;
  let fixedFuture = 0;
  let offset = 0;
  const page = 500;

  for (;;) {
    const { data, error } = await sb
      .from(t('narrative_posts'))
      .select(cs('narrative_posts', 'id', 'posted_at', 'first_seen_at'))
      .not(c('narrative_posts', 'posted_at'), 'is', null)
      .range(offset, offset + page - 1);

    if (error) throw new Error('load posts: ' + error.message);
    if (!data?.length) break;

    for (const row of data) {
      let next = Number(row.posted_at);
      if (!Number.isFinite(next) || next <= 0) continue;

      if (next < 1e12) {
        next = next * 1000;
        const { error: upErr } = await sb
          .from(t('narrative_posts'))
          .update(dbRow('narrative_posts', { posted_at: next }))
          .eq(c('narrative_posts', 'id'), row.id);
        if (!upErr) fixedSeconds += 1;
        continue;
      }

      const futureCutoff = Date.now() + MS_24H;
      if (next > futureCutoff && row.first_seen_at) {
        const fsMs = new Date(row.first_seen_at).getTime();
        if (Number.isFinite(fsMs)) {
          const { error: upErr } = await sb
            .from(t('narrative_posts'))
            .update(dbRow('narrative_posts', { posted_at: fsMs }))
            .eq(c('narrative_posts', 'id'), row.id);
          if (!upErr) fixedFuture += 1;
        }
      }
    }

    if (data.length < page) break;
    offset += page;
  }

  return { fixedSeconds, fixedFuture };
}

async function pruneStalePosts(sb) {
  const cutoff = Date.now() - MS_24H;
  let pruned = 0;
  let offset = 0;
  const page = 500;
  const now = new Date().toISOString();

  for (;;) {
    const { data, error } = await sb
      .from(t('narrative_posts'))
      .select(cs('narrative_posts', 'id', 'posted_at', 'tracking_status'))
      .eq(c('narrative_posts', 'tracking_status'), 'active')
      .not(c('narrative_posts', 'platform_post_id'), 'is', null)
      .not(c('narrative_posts', 'posted_at'), 'is', null)
      .range(offset, offset + page - 1);

    if (error) throw new Error('load active posts: ' + error.message);
    if (!data?.length) break;

    for (const row of data) {
      const ms = normalizePostedAt(row.posted_at);
      if (ms == null || ms >= cutoff) continue;
      const { error: upErr } = await sb
        .from(t('narrative_posts'))
        .update(dbRow('narrative_posts', { tracking_status: 'pruned', pruned_at: now }))
        .eq(c('narrative_posts', 'id'), row.id);
      if (!upErr) pruned += 1;
    }

    if (data.length < page) break;
    offset += page;
  }

  return pruned;
}

async function demoteStaleNarratives(sb) {
  const cutoff = Date.now() - MS_12H;
  const { data: eligible, error } = await sb
    .from(t('narratives'))
    .select(`
      ${c('narratives', 'id')},
      narrative_posts!${REL.narrative_posts_narrative_id_fkey} ( ${cs('narrative_posts', 'id', 'posted_at')} )
    `)
    .eq(c('narratives', 'display_eligible'), true)
    .eq(c('narratives', 'source'), 'cluster');

  if (error) throw new Error('load narratives: ' + error.message);

  let demoted = 0;
  const now = new Date().toISOString();

  for (const narr of eligible || []) {
    const posts = narr.narrative_posts || [];
    const hasRecent = posts.some(p => {
      const ms = normalizePostedAt(p.posted_at);
      return ms != null && ms >= cutoff;
    });
    if (hasRecent) continue;

    const { error: upErr } = await sb
      .from(t('narratives'))
      .update(dbRow('narratives', { display_eligible: false, gate_reason: 'too_old', updated_at: now }))
      .eq(c('narratives', 'id'), narr.id);
    if (!upErr) demoted += 1;
  }

  return demoted;
}

async function main() {
  loadEnvLocal();
  const sb = getServiceClient();

  console.log('[repair-stale] starting…');

  const units = await repairPostedAtUnits(sb);
  console.log(`[repair-stale] posted_at units — seconds→ms: ${units.fixedSeconds}, future clamped: ${units.fixedFuture}`);

  const pruned = await pruneStalePosts(sb);
  console.log(`[repair-stale] pruned active posts older than 24h: ${pruned}`);

  const demoted = await demoteStaleNarratives(sb);
  console.log(`[repair-stale] demoted display_eligible narratives (no post <12h): ${demoted}`);

  console.log('[repair-stale] done');
}

if (require.main === module) {
  main().catch(err => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { main, repairPostedAtUnits, pruneStalePosts, demoteStaleNarratives };
