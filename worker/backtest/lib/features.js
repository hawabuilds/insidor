'use strict';

/**
 * CRITICAL — NO LOOKAHEAD
 * -----------------------
 * Every feature in this module must use ONLY data knowable EARLY (default: T+30min
 * after the matched post was published). Never use a post's FINAL engagement,
 * peak views, or end-of-life metrics — that leaks the coin outcome and produces
 * useless "brilliant" backtest results.
 */

const { t, c, cs, row: dbRow } = require('../../../lib/db-schema');
const { CONFIG } = require('./config');

const WINDOW_MS = () => CONFIG.FEATURE_WINDOW_MIN * 60_000;

function snapshotAtT(snapshots, postPostedMs, windowMin = CONFIG.FEATURE_WINDOW_MIN) {
  const cutoff = postPostedMs + windowMin * 60_000;
  const inWindow = (snapshots || [])
    .map(s => ({
      ...s,
      at: Date.parse(s.captured_at),
      views: Number(s.views) || 0,
    }))
    .filter(s => Number.isFinite(s.at) && s.at <= cutoff && s.at >= postPostedMs)
    .sort((a, b) => a.at - b.at);
  return inWindow;
}

function viewsAtT(snapshots, postPostedMs) {
  const snaps = snapshotAtT(snapshots, postPostedMs);
  if (!snaps.length) return null;
  return snaps[snaps.length - 1].views;
}

function viewVelocityT(snapshots, postPostedMs) {
  const snaps = snapshotAtT(snapshots, postPostedMs);
  if (snaps.length < 2) {
    const v = snaps[0]?.views;
    if (v == null) return null;
    const elapsedMin = CONFIG.FEATURE_WINDOW_MIN;
    return v / elapsedMin;
  }
  const first = snaps[0];
  const last = snaps[snaps.length - 1];
  const dtMin = Math.max(1, (last.at - first.at) / 60_000);
  return (last.views - first.views) / dtMin;
}

function accelerationT(snapshots, postPostedMs) {
  const snaps = snapshotAtT(snapshots, postPostedMs);
  if (snaps.length < 3) return null;
  const mid = Math.floor(snaps.length / 2);
  const v1 = (snaps[mid].views - snaps[0].views) / Math.max(1, (snaps[mid].at - snaps[0].at) / 60_000);
  const v2 = (snaps[snaps.length - 1].views - snaps[mid].views) /
    Math.max(1, (snaps[snaps.length - 1].at - snaps[mid].at) / 60_000);
  return v2 - v1;
}

function engagementRateAtT(views, likes, replies, retweets, quotes) {
  if (!views || views <= 0) return null;
  const eng = (Number(likes) || 0) + (Number(replies) || 0) + (Number(retweets) || 0) + (Number(quotes) || 0);
  return eng / views;
}

async function loadPostContext(sb, platformPostId) {
  const { data: post, error } = await sb
    .from(t('narrative_posts'))
    .select(`${cs('narrative_posts')}, post_snapshots (${cs('post_snapshots')})`)
    .eq(c('narrative_posts', 'platform'), 'x')
    .eq(c('narrative_posts', 'platform_post_id'), platformPostId)
    .maybeSingle();
  if (error) throw new Error('narrative_posts: ' + error.message);

  let memeScore = null;
  if (post?.id) {
    const { data: scoreRow } = await sb
      .from(t('post_meme_scores'))
      .select(`${c('post_meme_scores', 'meme_score')}`)
      .eq(c('post_meme_scores', 'post_id'), post.id)
      .maybeSingle();
    memeScore = scoreRow?.meme_score ?? null;
  }

  return { post, memeScore };
}

async function computeFeaturesForCandidate(sb, candidate, token) {
  const postId = candidate.matched_platform_post_id;
  const postedMs = candidate.matched_post_at
    ? Date.parse(candidate.matched_post_at)
    : null;

  const ctx = postId ? await loadPostContext(sb, postId) : { post: null, memeScore: null };
  const post = ctx.post;
  const snapshots = post?.post_snapshots || [];

  const raw = candidate.matched_post_raw || {};
  const parsedPosted = postedMs || (post?.posted_at ? Number(post.posted_at) : null);

  let viewsT = null;
  let velocityT = null;
  let accelT = null;
  let engRate = null;
  let followers = null;
  let hadMedia = !!(raw.extendedEntities?.media?.length || post?.media_url);
  let tickerProposed = Number(post?.ticker_proposal_count) > 0;
  let ageMinSeen = null;
  let distinctAuthors = null;

  if (parsedPosted) {
    viewsT = viewsAtT(snapshots, parsedPosted);
    velocityT = viewVelocityT(snapshots, parsedPosted);
    accelT = accelerationT(snapshots, parsedPosted);

    if (viewsT == null && raw.viewCount != null) {
      viewsT = Number(raw.viewCount);
    }

    const likes = post?.likes ?? raw.likeCount;
    const replies = post?.replies ?? raw.replyCount;
    const retweets = post?.retweets ?? raw.retweetCount;
    const quotes = post?.quotes ?? raw.quoteCount;
    engRate = engagementRateAtT(viewsT, likes, replies, retweets, quotes);

    if (post?.first_seen_at && parsedPosted) {
      ageMinSeen = (Date.parse(post.first_seen_at) - parsedPosted) / 60_000;
    }
  }

  followers = Number(post?.followers) || Number(raw.author?.followers) || null;

  if (post?.narrative_id) {
    const { count } = await sb
      .from(t('narrative_posts'))
      .select('id', { count: 'exact', head: true })
      .eq(c('narrative_posts', 'narrative_id'), post.narrative_id)
      .eq(c('narrative_posts', 'platform'), 'x');
    distinctAuthors = count ?? null;
  }

  return {
    feature_window_min: CONFIG.FEATURE_WINDOW_MIN,
    views_at_t: viewsT,
    view_velocity_t: velocityT,
    acceleration_t: accelT,
    author_followers: followers,
    engagement_rate_t: engRate,
    had_media: hadMedia,
    distinct_authors_t: distinctAuthors,
    age_min_when_seen: ageMinSeen,
    ticker_proposed_in_replies: tickerProposed,
    meme_score: ctx.memeScore,
    in_narrative_posts: !!post,
    narrative_post_id: post?.id || null,
    raw: { had_pipeline_post: !!post, snapshot_count: snapshots.length },
  };
}

module.exports = {
  computeFeaturesForCandidate,
  viewsAtT,
  viewVelocityT,
  snapshotAtT,
  WINDOW_MS,
};
