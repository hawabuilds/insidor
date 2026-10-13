/**
 * Whether a single post has enough reach for For You or for Popular — the owner's reach bars.
 *
 * Its own file beside `post-score.ts` because it is the other half of the feed's gate: the score
 * says whether there is a memeable subject, this says whether enough people are seeing it. A post
 * needs both. Kept in core, pure, so the projector and any backtest hold a post to one rule.
 *
 * For You takes a post at `rising.fypMinReach`, OR earlier when it is taking off: `fypEarlyReach`
 * read within `fypEarlyWindowMs` of being posted, or any reading inside `fypFastWindowMs` that
 * averages `fypFastReachPerMinute` since the post. Popular takes `popularMinReach`. Once a post
 * has cleared a growth path it stays cleared: a post caught early is not dropped for slowing.
 *
 * ★ AN UNREAD COUNT IS NOT A SMALL ONE, AND IT IS NOT A PASS. A post with no view reading, or no
 * post time for the growth paths, does not clear a bar on that path — it waits, off the feed.
 *
 * ★ THE SHORT-VIDEO SOURCE HAS ITS OWN GROWTH PATHS (`rising.shortVideoEarly*` / `shortVideoFast*`),
 * not the text ones scaled: it is found 30 minutes to 6 hours after posting and re-read every half
 * hour, so a fifteen-minute or half-hour window never holds one of its readings. The caller says
 * which source by the scale it passes — 1 for a text post, anything else is the short-video
 * source's — so every caller that already scales its bars gets the paths with no change.
 *
 * What breaks if changed carelessly: growth is reach over minutes SINCE THE POST, never since we
 * first saw it. Measured from our own first sight, a two-day-old post read once would look like it
 * had gained every view it ever had in one minute.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { MS_PER_MINUTE } from '../math.ts';

/** One reading of a post's view count: when we read it, and the count (null if unreadable). */
export interface ReachLevel {
  readonly atMs: number;
  readonly reach: number | null;
}

export type ReachBar = 'fyp' | 'popular';

/**
 * @param scale the total bars times this: 1 for a text post, `rising.shortVideoReachScale` for the
 *   short-video source, whose views run an order of magnitude higher; any scale but 1 also takes
 *   that source's own growth paths. The caller knows the source; core does not name it.
 */
export function clearsReachBar(bar: ReachBar, readings: readonly ReachLevel[], postedAtMs: number | null, p: Policy, scale = 1): boolean {
  const r = p.rising;
  const read = readings.filter((x): x is { atMs: number; reach: number } => x.reach !== null);
  const most = read.reduce((m, x) => Math.max(m, x.reach), Number.NEGATIVE_INFINITY);
  if (bar === 'popular') return most >= r.popularMinReach * scale;
  if (most >= r.fypMinReach * scale) return true;
  if (postedAtMs === null) return false;
  const short = scale !== 1;
  const early = short ? { reach: r.shortVideoEarlyReach, windowMs: r.shortVideoEarlyWindowMs } : { reach: r.fypEarlyReach, windowMs: r.fypEarlyWindowMs };
  const fast = short ? { perMinute: r.shortVideoFastReachPerMinute, windowMs: r.shortVideoFastWindowMs } : { perMinute: r.fypFastReachPerMinute, windowMs: r.fypFastWindowMs };
  return read.some((x) => {
    const ageMs = x.atMs - postedAtMs;
    if (ageMs <= 0) return false;
    if (ageMs <= early.windowMs && x.reach >= early.reach) return true;
    return ageMs <= fast.windowMs && x.reach / (ageMs / MS_PER_MINUTE) >= fast.perMinute;
  });
}
