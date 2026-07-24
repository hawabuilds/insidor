'use strict';

const { postCreatedMs } = require('./posted-at');

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Median minutes from earliest member post created_at → narrative display_eligible.
 * Uses lead_time_min when set; otherwise updated_at as eligibility proxy.
 */
async function medianEligibilityLatencyMinutes(sb) {
  const { data, error } = await sb
    .from('narratives')
    .select(`
      id, lead_time_min, updated_at, display_eligible,
      narrative_posts!narrative_posts_narrative_id_fkey ( posted_at, first_seen_at )
    `)
    .eq('display_eligible', true)
    .eq('source', 'cluster');

  if (error) throw new Error('latency select: ' + error.message);

  const minutes = [];
  for (const narr of data || []) {
    if (narr.lead_time_min != null && narr.lead_time_min > 0) {
      minutes.push(narr.lead_time_min);
      continue;
    }

    const posts = narr.narrative_posts || [];
    const createdMs = posts.reduce((min, p) => {
      const t = postCreatedMs(p);
      if (t == null) return min;
      return min == null ? t : Math.min(min, t);
    }, null);

    if (createdMs == null) continue;

    const eligibleMs = narr.updated_at
      ? new Date(narr.updated_at).getTime()
      : Date.now();
    minutes.push(Math.max(0, (eligibleMs - createdMs) / 60000));
  }

  minutes.sort((a, b) => a - b);
  return {
    median: percentile(minutes, 0.5),
    count: minutes.length,
    p90: percentile(minutes, 0.9),
  };
}

async function logEligibilityLatency(sb, tag = 'pipeline') {
  try {
    const { median, count, p90 } = await medianEligibilityLatencyMinutes(sb);
    if (!count) {
      console.log(`[${tag}] e2e latency (post_created → display_eligible): no eligible cluster narratives yet`);
      return null;
    }
    const med = median != null ? median.toFixed(1) : '—';
    const p90s = p90 != null ? p90.toFixed(1) : '—';
    console.log(
      `[${tag}] e2e latency (post_created → display_eligible): median ${med} min · p90 ${p90s} min · n=${count}`,
    );
    return { median, p90, count };
  } catch (e) {
    console.warn(`[${tag}] e2e latency metric failed:`, e.message);
    return null;
  }
}

module.exports = {
  medianEligibilityLatencyMinutes,
  logEligibilityLatency,
  postCreatedMs,
};
