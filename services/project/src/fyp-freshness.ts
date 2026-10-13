/**
 * WHETHER A POST IS STILL FRESH ENOUGH FOR FOR YOU — the owner's six-hour rule.
 *
 * For You is what is happening now. A post older than `rising.fypMaxAgeMs` leaves it unless it is
 * still growing fast: its newest view reading was taken inside the last `fypGrowthWindowMs`, and
 * between that reading and the earliest one in the `fypGrowthWindowMs` before it — at least
 * `fypGrowthMinSpanMs` apart — it gained `fypStillGrowingPerMinute` views a minute or more (times
 * the short-video scale for a short video). Popular is not held to this: an old big post can stay
 * there for the whole window.
 *
 * Its own file, not inside `rising.ts` or core's reach bar, because it is a different question: the
 * reach bar asks whether a post EVER took off and never takes that back; this asks whether it is
 * still taking off NOW, and does take it back. Keeping them apart keeps the reach bar's "once
 * cleared, stays cleared" promise true for Popular.
 *
 * ★ AN UNREAD OR STALE GROWTH IS NOT FAST GROWTH. Censored readings carry no count and are skipped;
 * a newest reading older than the growth window says nothing about now; two readings closer than
 * the minimum span are too near to make a rate from. Each of these lets an old post go — the rule
 * keeps an old post only on evidence that it is still climbing.
 *
 * What breaks if changed carelessly: the rate is measured between two of OUR readings, never from
 * the post time. From the post time a day-old post with a million views averages 700 a minute
 * forever, and nothing old would ever leave.
 */

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { ReachLevel } from '@insidor/core';

const MS_PER_MINUTE = 60_000;

/** True when the post may stay on For You: young enough, or old and still climbing fast. */
export function freshForYou(
  views: readonly ReachLevel[],
  postedAtMs: number,
  nowMs: number,
  policy = DEFAULT_POLICY,
  scale = 1,
): boolean {
  const r = policy.rising;
  if (nowMs - postedAtMs <= r.fypMaxAgeMs) return true;
  const counted = views.filter((v): v is { atMs: number; reach: number } => v.reach !== null).sort((a, b) => a.atMs - b.atMs);
  const newest = counted[counted.length - 1];
  if (newest === undefined || nowMs - newest.atMs > r.fypGrowthWindowMs) return false;
  const earliest = counted.find((v) => v.atMs >= newest.atMs - r.fypGrowthWindowMs);
  if (earliest === undefined) return false;
  const spanMs = newest.atMs - earliest.atMs;
  if (spanMs < r.fypGrowthMinSpanMs) return false;
  return (newest.reach - earliest.reach) / (spanMs / MS_PER_MINUTE) >= r.fypStillGrowingPerMinute * scale;
}
