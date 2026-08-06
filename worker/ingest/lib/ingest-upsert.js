'use strict';

const { t, c, cs, row: dbRow, onConflictCols } = require('../../../lib/db-schema');
const { normalizePostedAt } = require('../../lib/posted-at');
const { scanPostSignals } = require('../../cluster/lib/ticker-proposals');

/** Shared narrative_posts upsert — used by X and TikTok ingest adapters. */
async function upsertIngestedPost(sb, parsed, sourceLabel) {
  const nowIso = new Date().toISOString();
  const postedMs = normalizePostedAt(parsed.postedAt);

  const { data: existing, error: selErr } = await sb
    .from(t('narrative_posts'))
    .select(cs('narrative_posts', 'id', 'first_seen_at', 'tracking_status'))
    .eq(c('narrative_posts', 'platform'), parsed.platform)
    .eq(c('narrative_posts', 'platform_post_id'), parsed.platformPostId)
    .maybeSingle();

  if (selErr) throw new Error('select post: ' + selErr.message);

  const signals = scanPostSignals({
    text: parsed.text,
    handle: parsed.handle,
    raw: parsed.raw,
    sample_replies: parsed.sampleReplies,
  });

  const fields = {
    platform: parsed.platform,
    platform_post_id: parsed.platformPostId,
    sort_order: 0,
    handle: parsed.handle,
    text: parsed.text,
    followers: parsed.followers,
    image: parsed.image,
    media_url: parsed.mediaUrl || null,
    media_type: parsed.mediaType || null,
    views: parsed.views,
    replies: parsed.replies,
    quotes: parsed.quotes,
    likes: parsed.likes,
    retweets: parsed.retweets,
    notable: parsed.notable,
    sample_replies: parsed.sampleReplies,
    posted_at: postedMs,
    first_seen_at: existing?.first_seen_at || nowIso,
    raw: parsed.raw,
    filter_label: sourceLabel,
    sound_id: parsed.soundId || null,
    subject_entity: parsed.subjectEntity || null,
    ct_pickup: signals.ct_pickup,
    ticker_proposal_count: signals.ticker_proposal_count,
  };

  if (!existing) {
    fields.narrative_id = null;
    fields.tracking_status = 'active';
  } else if (existing.tracking_status === 'pruned') {
    return null;
  }

  const row = dbRow('narrative_posts', fields);

  const { data: upserted, error: upErr } = await sb
    .from(t('narrative_posts'))
    .upsert(row, { onConflict: onConflictCols('narrative_posts', 'platform', 'platform_post_id') })
    .select(c('narrative_posts', 'id'))
    .single();

  if (upErr) throw new Error('upsert post: ' + upErr.message);
  return upserted.id;
}

module.exports = { upsertIngestedPost };
