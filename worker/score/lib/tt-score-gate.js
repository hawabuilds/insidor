'use strict';

const { scanPostSignals } = require('../../cluster/lib/ticker-proposals');
const { postAgeMinutes } = require('../../lib/posted-at');
const { countTikTokSoundAuthors, soundIdFromPost } = require('../../cluster/lib/replication');

const MIN_VIEWS_TT = Number(process.env.MIN_INGEST_VIEWS_TT) || 100_000;
const MAX_AGE_MIN_TT = Number(process.env.MAX_POST_AGE_MIN_TT) || 1440;
const MIN_SOUND_CREATORS = Number(process.env.TT_VISION_MIN_SOUND_CREATORS) || 2;

/**
 * Cheap pre-Claude gate for TikTok vision scoring.
 * Requires recency + views floor + (replication | ct_pickup | ticker proposal).
 */
async function evaluateTikTokVisionGate(post, sb) {
  const age = postAgeMinutes(post);
  if (age == null || age > MAX_AGE_MIN_TT) {
    return { ok: false, reason: 'too_old' };
  }

  const views = Number(post.views) || 0;
  if (views < MIN_VIEWS_TT) {
    return { ok: false, reason: 'below_views' };
  }

  const sig = scanPostSignals(post);
  if (sig.ct_pickup) {
    return { ok: true, reason: 'ct_pickup' };
  }
  if (sig.ticker_proposal_count > 0) {
    return { ok: true, reason: 'ticker_proposal' };
  }

  const soundId = soundIdFromPost(post);
  if (soundId && sb) {
    const rep = await countTikTokSoundAuthors(sb, soundId);
    if (rep.distinct >= MIN_SOUND_CREATORS) {
      return { ok: true, reason: 'replication', distinct: rep.distinct };
    }
  }

  return { ok: false, reason: 'no_signal' };
}

module.exports = {
  evaluateTikTokVisionGate,
  MIN_VIEWS_TT,
  MAX_AGE_MIN_TT,
  MIN_SOUND_CREATORS,
};
