'use strict';

/** Weighted engagement: likes + 2×reposts + replies (snapshot fields). */
function engagement(snapshot) {
  if (!snapshot || snapshot.unavailable) return null;
  const likes = snapshot.likes ?? 0;
  const reposts = snapshot.retweets ?? 0;
  const replies = snapshot.replies ?? 0;
  return likes + 2 * reposts + replies;
}

/** Organic signal: weighted engagement / views (null when views missing or zero). */
function engagementRateFromCounts(likes, retweets, replies, views) {
  const v = views ?? 0;
  if (v <= 0) return null;
  return ((likes ?? 0) + 2 * (retweets ?? 0) + (replies ?? 0)) / v;
}

function engagementRateFromParsed(parsed) {
  if (!parsed) return null;
  return engagementRateFromCounts(parsed.likes, parsed.retweets, parsed.replies, parsed.views);
}

function sortedSnapshots(post) {
  return (post.post_snapshots || [])
    .filter(s => !s.unavailable)
    .slice()
    .sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
}

function snapshotViews(snap) {
  if (!snap || snap.unavailable) return null;
  if (snap.views == null) return null;
  return snap.views;
}

function deltaPerMinute(newer, older, valueFn) {
  const vNew = valueFn(newer);
  const vOld = valueFn(older);
  if (vNew == null || vOld == null) return null;
  const ms = new Date(newer.captured_at) - new Date(older.captured_at);
  const minutes = ms / 60000;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return (vNew - vOld) / minutes;
}

/** Primary ranking signal: Δviews / minutes (two most recent snapshots). */
function viewsVelocity(post) {
  const snaps = sortedSnapshots(post);
  if (snaps.length < 2) return null;
  return deltaPerMinute(snaps[0], snaps[1], snapshotViews);
}

/** Supporting quality signal: Δengagement / minutes. */
function engagementVelocity(post) {
  const snaps = sortedSnapshots(post);
  if (snaps.length < 2) return null;
  return deltaPerMinute(snaps[0], snaps[1], engagement);
}

/** Acceleration of views velocity: v_recent − v_previous (three snapshots). */
function viewsAcceleration(post) {
  const snaps = sortedSnapshots(post);
  if (snaps.length < 3) return null;
  const vRecent = deltaPerMinute(snaps[0], snaps[1], snapshotViews);
  const vPrevious = deltaPerMinute(snaps[1], snaps[2], snapshotViews);
  if (vRecent == null || vPrevious == null) return null;
  return vRecent - vPrevious;
}

/** Lifecycle from views velocity + acceleration (heating / peaking / cooling). */
function lifecycleFromViewsMetrics(viewsVel, accel) {
  const v = viewsVel ?? 0;
  const a = accel ?? 0;
  if (v <= 0 && a <= 0) return 'peaking';
  const rel = v > 0 ? a / v : (a !== 0 ? Math.sign(a) : 0);
  if (rel > 0.12 && v > 0) return 'heating';
  if (rel < -0.07 || a < -500) return 'cooling';
  return 'peaking';
}

/** Share of latest snapshots missing view counts — pipeline health check. */
function missingViewsStats(posts) {
  let checked = 0;
  let missing = 0;
  for (const post of posts || []) {
    const snaps = sortedSnapshots(post);
    if (!snaps.length) continue;
    checked += 1;
    if (snaps[0].views == null) missing += 1;
  }
  return {
    checked,
    missing,
    pct: checked ? (missing / checked) * 100 : 0,
  };
}

/** @deprecated use viewsVelocity */
function velocity(post) {
  return viewsVelocity(post);
}

module.exports = {
  engagement,
  engagementRateFromCounts,
  engagementRateFromParsed,
  sortedSnapshots,
  viewsVelocity,
  engagementVelocity,
  viewsAcceleration,
  lifecycleFromViewsMetrics,
  missingViewsStats,
  velocity,
};
