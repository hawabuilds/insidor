'use strict';

const { t, c, cs, row: dbRow, onConflictCols } = require('../../../lib/db-schema');
const { getTweetsByIds, tweetsInResponse } = require('../../adapters/x/reader');
const { parseRawPost } = require('./parse-raw-post');
const { insertPostSnapshot, engagementFromParsed } = require('../../snapshot/lib/snapshots');
const { isPostWithinMaxAge, trackIngestAge } = require('../../lib/posted-at');

const NEAR_MISS_TTL_MS = 12 * 60 * 60 * 1000;
const RECHECK_BATCH = 50;

async function upsertNearMiss(sb, parsed) {
  const now = new Date().toISOString();
  const { data: existing } = await sb
    .from(t('ingest_near_miss'))
    .select(c('ingest_near_miss', 'first_seen_at'))
    .eq(c('ingest_near_miss', 'platform_post_id'), parsed.platformPostId)
    .maybeSingle();

  const row = dbRow('ingest_near_miss', {
    platform_post_id: parsed.platformPostId,
    platform: parsed.platform,
    views: parsed.views ?? 0,
    likes: parsed.likes ?? 0,
    first_seen_at: existing?.first_seen_at || now,
    last_checked_at: now,
    raw: parsed.raw,
  });
  const { error } = await sb
    .from(t('ingest_near_miss'))
    .upsert(row, { onConflict: onConflictCols('ingest_near_miss', 'platform_post_id') });
  if (error) throw new Error('near_miss upsert: ' + error.message);
}

async function expireNearMiss(sb) {
  const cutoff = new Date(Date.now() - NEAR_MISS_TTL_MS).toISOString();
  const { data, error } = await sb
    .from(t('ingest_near_miss'))
    .delete()
    .lt(c('ingest_near_miss', 'first_seen_at'), cutoff)
    .select(c('ingest_near_miss', 'platform_post_id'));
  if (error) throw new Error('near_miss expire: ' + error.message);
  return (data || []).length;
}

async function recheckNearMisses(sb, minViews, maxAgeMinX, upsertIngestedPost, opts = {}) {
  await expireNearMiss(sb);

  const { data: rows, error } = await sb
    .from(t('ingest_near_miss'))
    .select(cs('ingest_near_miss', 'platform_post_id', 'views'))
    .order(c('ingest_near_miss', 'views'), { ascending: false })
    .limit(RECHECK_BATCH);

  if (error) throw new Error('near_miss select: ' + error.message);
  if (!rows?.length) {
    return { promoted: 0, reads: 0, tweetsBilled: 0, apiCalls: 0, droppedStale: 0, ingestAgesMin: [] };
  }

  const ids = rows.map(r => r.platform_post_id);
  const api = await getTweetsByIds(ids);
  const tweetsBilled = tweetsInResponse(api);
  const apiCalls = ids.length ? 1 : 0;
  if (tweetsBilled > 0 && typeof opts.billReads === 'function') {
    await opts.billReads(tweetsBilled);
  }
  let promoted = 0;
  let droppedStale = 0;
  const ingestAgesMin = [];
  const nowMs = Date.now();
  const now = new Date().toISOString();

  for (const raw of api.tweets || []) {
    try {
      const parsed = parseRawPost(raw);
      if (!isPostWithinMaxAge(parsed, maxAgeMinX, nowMs)) {
        droppedStale += 1;
        await sb
          .from(t('ingest_near_miss'))
          .delete()
          .eq(c('ingest_near_miss', 'platform_post_id'), parsed.platformPostId);
        continue;
      }
      if ((parsed.views ?? 0) < minViews) {
        await sb
          .from(t('ingest_near_miss'))
          .update(dbRow('ingest_near_miss', {
            views: parsed.views ?? 0,
            likes: parsed.likes ?? 0,
            last_checked_at: now,
          }))
          .eq(c('ingest_near_miss', 'platform_post_id'), parsed.platformPostId);
        continue;
      }
      const postId = await upsertIngestedPost(sb, parsed, 'near_miss');
      if (!postId) continue;
      await insertPostSnapshot(sb, postId, engagementFromParsed(parsed));
      await sb
        .from(t('ingest_near_miss'))
        .delete()
        .eq(c('ingest_near_miss', 'platform_post_id'), parsed.platformPostId);
      promoted += 1;
      trackIngestAge({ ingestAgesMin }, parsed, nowMs);
    } catch (e) {
      console.warn('[near_miss] promote failed:', e.message);
    }
  }

  return { promoted, reads: tweetsBilled, tweetsBilled, apiCalls, droppedStale, ingestAgesMin };
}

module.exports = { upsertNearMiss, expireNearMiss, recheckNearMisses, NEAR_MISS_TTL_MS };
