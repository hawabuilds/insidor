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
 * ★ THE SPEED BAR (`rising.speedBar`, off by default): a text post also clears For You when a
 * reading shows it on pace to pass the total by `horizonMs` — its views a minute since the post,
 * and since an earlier reading when there is one, both at `fypMinReach / horizonMs` or more. Both
 * rates, because a post that spiked and then stalled still has a fast average; the recent rate is
 * what says it is still climbing. It only adds a way in: switched off, every caller (the scorer,
 * the projector, the replays) holds a post to exactly the bars above.
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
  /* The short-video speed bar, when on, lowers that source's two growth paths (policy `rising.shortVideoSpeedBar`). */
  const sb = r.shortVideoSpeedBar;
  const shortEarly = sb.enabled ? sb.earlyReach : r.shortVideoEarlyReach;
  const shortFast = sb.enabled ? sb.fastReachPerMinute : r.shortVideoFastReachPerMinute;
  const early = short ? { reach: shortEarly, windowMs: r.shortVideoEarlyWindowMs } : { reach: r.fypEarlyReach, windowMs: r.fypEarlyWindowMs };
  const fast = short ? { perMinute: shortFast, windowMs: r.shortVideoFastWindowMs } : { perMinute: r.fypFastReachPerMinute, windowMs: r.fypFastWindowMs };
  return read.some((x) => {
    const ageMs = x.atMs - postedAtMs;
    if (ageMs <= 0) return false;
    if (ageMs <= early.windowMs && x.reach >= early.reach) return true;
    if (ageMs <= fast.windowMs && x.reach / (ageMs / MS_PER_MINUTE) >= fast.perMinute) return true;
    return !short && onPace(read, x, ageMs, p);
  });
}

/**
 * Whether reading `x` (one of `read`, `ageMs` after the post) puts a text post on pace to
 * pass `fypMinReach` by `speedBar.horizonMs`: inside its window, over its floor, and fast enough
 * both since the post and since the newest reading at least `recentMinSpanMs` before it.
 */
function onPace(read: readonly { atMs: number; reach: number }[], x: { atMs: number; reach: number }, ageMs: number, p: Policy): boolean {
  const s = p.rising.speedBar;
  if (!s.enabled) return false;
  if (ageMs < s.minAgeMs || ageMs > s.horizonMs || x.reach < s.minReach) return false;
  const needPerMs = p.rising.fypMinReach / s.horizonMs;
  if (x.reach / ageMs < needPerMs) return false;
  /* By time, not by position: a caller's readings need not be in order. */
  const before = read.reduce<{ atMs: number; reach: number } | undefined>((b, y) => (x.atMs - y.atMs >= s.recentMinSpanMs && (b === undefined || y.atMs > b.atMs) ? y : b), undefined);
  return before === undefined || (x.reach - before.reach) / (x.atMs - before.atMs) >= needPerMs;
}
