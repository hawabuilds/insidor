'use strict';

const { tokenizeForMatching } = require('./text-utils');
const { isGenericTicker, normalizeTicker } = require('./nameability');

function memeScoreRow(post) {
  const ms = post?.post_meme_scores;
  return Array.isArray(ms) ? ms[0] : ms;
}

/** Distinctive searchable entity — noun/name, not full post text. */
function extractSubjectEntity(post) {
  const ms = memeScoreRow(post);
  const fromTicker = normalizeTicker(ms?.suggested_ticker);
  if (fromTicker && !isGenericTicker(fromTicker)) return fromTicker.toLowerCase();

  const fromName = (ms?.suggested_name || '').trim();
  if (fromName.length >= 3 && fromName.length <= 24 && !/\s{2,}/.test(fromName)) {
    const word = fromName.split(/\s+/)[0];
    if (word.length >= 3 && !isGenericTicker(word)) return word.toLowerCase();
  }

  if (post?.subject_entity) return String(post.subject_entity).toLowerCase();

  const tokens = tokenizeForMatching(post?.text || '', post?.handle);
  const sorted = tokens.slice().sort((a, b) => b.length - a.length);
  for (const t of sorted) {
    if (t.length >= 4 && !isGenericTicker(t.toUpperCase())) return t.toLowerCase();
  }

  return null;
}

function buildEntitySearchQuery(entity, windowMin = 120, nowMs = Date.now()) {
  const term = String(entity || '').trim().replace(/"/g, '');
  if (!term) return null;
  const untilSec = Math.floor(nowMs / 1000);
  const sinceSec = Math.floor((nowMs - windowMin * 60_000) / 1000);
  return `"${term}" lang:en -filter:replies -filter:retweets since_time:${sinceSec} until_time:${untilSec}`;
}

module.exports = {
  extractSubjectEntity,
  buildEntitySearchQuery,
  memeScoreRow,
};
