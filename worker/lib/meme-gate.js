'use strict';

const MEME_MIN_X = Number(process.env.MEME_MIN_X) || 0.6;
const MEME_MIN_TT = Number(process.env.MEME_MIN_TT) || 0.75;
const CROSS_PLATFORM_DISCOUNT = Number(process.env.CROSS_PLATFORM_DISCOUNT) || 0.1;
const TT_NO_THUMB_CAP = 0.4;

function memeMinForPost(platform) {
  return platform === 'tt' ? MEME_MIN_TT : MEME_MIN_X;
}

/** Effective narrative gate — cross-platform narratives get a lower bar. */
function memeMinForNarrative(platforms) {
  const set = new Set((platforms || []).map(p => (p === 'tt' ? 'tt' : 'x')));
  const cross = set.has('x') && set.has('tt');
  if (cross) return Math.max(0, MEME_MIN_X - CROSS_PLATFORM_DISCOUNT);
  if (set.has('tt') && !set.has('x')) return MEME_MIN_TT;
  return MEME_MIN_X;
}

function formatMemeGateLine(stats) {
  const fmt = (key, label) => {
    const s = stats[key] || { scored: 0, pass: 0 };
    const pct = s.scored ? Math.round((s.pass / s.scored) * 100) : 0;
    return `${label} ${s.pass}/${s.scored} (${pct}%)`;
  };
  return `meme gate: ${fmt('x', 'x')} · ${fmt('tt', 'tt')}`;
}

function emptyGateStats() {
  return { x: { scored: 0, pass: 0 }, tt: { scored: 0, pass: 0 } };
}

function recordGatePass(stats, platform, passed) {
  const key = platform === 'tt' ? 'tt' : 'x';
  stats[key].scored += 1;
  if (passed) stats[key].pass += 1;
}

module.exports = {
  MEME_MIN_X,
  MEME_MIN_TT,
  CROSS_PLATFORM_DISCOUNT,
  TT_NO_THUMB_CAP,
  memeMinForPost,
  memeMinForNarrative,
  formatMemeGateLine,
  emptyGateStats,
  recordGatePass,
};
