'use strict';

const { stripMatchingNoise } = require('../../lib/text-utils');

const TITLE_STOP = new Set([
  'that', 'this', 'with', 'from', 'have', 'just', 'your', 'what', 'when', 'them',
  'then', 'than', 'they', 'will', 'would', 'could', 'should', 'about', 'into',
  'after', 'before', 'there', 'their', 'been', 'being', 'were', 'where', 'which',
  'while', 'only', 'also', 'very', 'some', 'more', 'most', 'much', 'like', 'know',
  'dont', 'does', 'did', 'not', 'but', 'and', 'the', 'for', 'you', 'are', 'was',
  'has', 'had', 'can', 'all', 'one', 'out', 'get', 'got', 'its', 'our', 'how',
  'why', 'who', 'she', 'his', 'her', 'any', 'may', 'way', 'new', 'now', 'too',
  'says', 'said', 'viral', 'video', 'watch', 'breaking', 'news', 'story', 'trend',
  'trending', 'post', 'posts', 'tweet', 'thread', 'update', 'live', 'real', 'time',
]);

/**
 * Derive a Google Trends query from a narrative title.
 * Strips @handles, $cashtags, hashtags; returns 2–3 distinctive words.
 */
function deriveTrendTerm(title) {
  const cleaned = stripMatchingNoise(title || '');
  if (!cleaned) return '';

  const raw = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^'+|'+$/g, ''))
    .filter(w => w.length >= 3 && !TITLE_STOP.has(w));

  if (!raw.length) {
    const fallback = (title || '').replace(/[@#$]\S+/g, ' ').trim().split(/\s+/).slice(0, 3);
    return fallback.join(' ').slice(0, 80);
  }

  const seen = new Set();
  const unique = [];
  for (const w of raw) {
    if (seen.has(w)) continue;
    seen.add(w);
    unique.push(w);
  }

  unique.sort((a, b) => b.length - a.length || a.localeCompare(b));

  const picked = unique.slice(0, 3);
  if (picked.length >= 2) return picked.join(' ');

  const fill = raw.filter(w => !picked.includes(w));
  while (picked.length < 2 && fill.length) picked.push(fill.shift());
  return picked.join(' ').slice(0, 80);
}

module.exports = { deriveTrendTerm, TITLE_STOP };
