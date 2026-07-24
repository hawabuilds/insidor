'use strict';

const FLAT_VIEW_THRESHOLD = Number(process.env.TT_FLAT_VIEW_PCT) || 0.8;

let velocityUnreliable = null;
let lastDiagnostic = null;

function distinctViewValues(post) {
  const snaps = (post?.post_snapshots || [])
    .filter(s => !s.unavailable && s.views != null)
    .map(s => Number(s.views));
  return [...new Set(snaps)];
}

function analyzePosts(posts) {
  const tt = (posts || []).filter(p => p.platform === 'tt');
  let checked = 0;
  let flat = 0;
  const samples = [];

  for (const post of tt) {
    const distinct = distinctViewValues(post);
    if (distinct.length < 1) continue;
    checked += 1;
    const isFlat = distinct.length <= 1;
    if (isFlat) flat += 1;
    if (samples.length < 5) {
      samples.push({
        id: post.id,
        handle: post.handle,
        distinctViews: distinct.length,
        values: distinct.slice(0, 4),
      });
    }
  }

  const flatPct = checked > 0 ? flat / checked : 0;
  const unreliable = checked >= 3 && flatPct >= FLAT_VIEW_THRESHOLD;

  return {
    checked,
    flat,
    flatPct,
    unreliable,
    samples,
  };
}

function setDiagnosticResult(result) {
  lastDiagnostic = result;
  if (result?.checked >= 3) {
    velocityUnreliable = !!result.unreliable;
  }
  return result;
}

function isTikTokVelocityUnreliable() {
  return velocityUnreliable === true;
}

function getLastDiagnostic() {
  return lastDiagnostic;
}

function logDiagnostic(result, tag = 'snapshotter') {
  if (!result?.checked) return;
  console.log(
    `[${tag}] tt views diagnostic: ${result.checked} posts, ` +
    `${(result.flatPct * 100).toFixed(0)}% flat playCount ` +
    `(${result.flat}/${result.checked})` +
    (result.unreliable ? ' — velocity gate DISABLED for TikTok' : ''),
  );
  if (result.samples?.length) {
    for (const s of result.samples) {
      console.log(
        `[${tag}]   ${s.handle} distinct=${s.distinctViews} values=[${s.values.join(', ')}]`,
      );
    }
  }
}

module.exports = {
  analyzePosts,
  setDiagnosticResult,
  isTikTokVelocityUnreliable,
  getLastDiagnostic,
  logDiagnostic,
  distinctViewValues,
};
