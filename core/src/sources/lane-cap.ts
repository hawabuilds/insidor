/**
 * A SEARCH LANE'S OWN DAILY CAP (`LaneCapPolicy`): whether one more ask fits, and what judging a
 * lane's new posts are charged.
 *
 * Pure and in core because both are thresholds out of policy applied to numbers the runner hands
 * in — what the lane has spent today, what the next ask is quoted at, how many of its posts no
 * lane held before. The runner reads and writes the ledger (0088, work/lane-ledger.ts).
 *
 * What breaks if changed carelessly: the check is on spent PLUS the quote, never spent alone. A
 * lane checked on what it has already spent asks once more after reaching its cap, every pass,
 * and a page-by-page lane (the text source's middle lane) would overrun by a whole pass.
 */

import type { LaneCapPolicy, Policy } from '@insidor/contracts/policy.ts';

import { MS_PER_DAY } from '../math.ts';

/** True when an ask quoted at `askUsd` keeps the lane's day at or under its cap. */
export function laneMayAsk(spentUsd: number, askUsd: number, cap: LaneCapPolicy): boolean {
  if (!Number.isFinite(spentUsd) || !Number.isFinite(askUsd)) return false;
  return spentUsd + Math.max(0, askUsd) <= cap.dailyUsd;
}

/**
 * The judging a lane is charged for the posts it found first: each one times the judge's price
 * times the share of such posts the judge is asked about at all.
 */
export function laneJudgeUsd(newPosts: number, cap: LaneCapPolicy): number {
  return Math.max(0, newPosts) * cap.judgeUsdPerPost * cap.judgedShare;
}

/**
 * ★ THE X SEARCH DAY'S ALLOWANCE AT `now` (`feed.searchDay`): what the whole day's search may have
 * spent by this instant — `dailyUsd` spread evenly over the UTC day, `aheadMs` of it allowed early so
 * a pass at a quarter past midnight is not refused for being a quarter-hour in. Never above
 * `dailyUsd`, so by midnight the day is the hard total and no more. Infinite while off.
 *
 * What breaks if changed carelessly: an allowance on the day alone (no pace) lets a busy night spend
 * the day by breakfast, which is how 19 Oct 2026 spent $8.50 by 08:00 UTC; a pace with no `aheadMs`
 * refuses the first ask of every day.
 */
/** When today's X search bill starts: 00:00 UTC, or `countFrom` when it falls later on the same UTC day. */
export function searchDayStart(now: number, p: Policy): number {
  const dayStart = now - (((now % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY);
  const from = p.feed.searchDay.countFromMs ?? Number.NaN;
  return Number.isFinite(from) && from > dayStart && from < dayStart + MS_PER_DAY && from <= now ? from : dayStart;
}

export function searchDayAllowanceUsd(now: number, p: Policy): number {
  const d = p.feed.searchDay;
  if (!d.on) return Number.POSITIVE_INFINITY;
  const sinceStart = now - searchDayStart(now, p);
  return d.dailyUsd * Math.min(1, (sinceStart + Math.max(0, d.aheadMs)) / MS_PER_DAY);
}

/**
 * What a paced search (`SearchPagingPolicy.paced`) may have spent by `now`: its `dailyUsd` on the UTC
 * day's pace, `feed.searchDay.aheadMs` early, never above `dailyUsd`. Its own day starts at 00:00 UTC,
 * as its ledger lane's does (internal.lane_spend), not at the search day's `countFromMs`.
 */
export function pacedDailyUsd(dailyUsd: number, now: number, p: Policy): number {
  const sinceStart = (((now % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY);
  return dailyUsd * Math.min(1, (sinceStart + Math.max(0, p.feed.searchDay.aheadMs)) / MS_PER_DAY);
}

/** What the day's X re-reads may have spent by `now`: `rereadDailyUsd` on the search day's pace and start. */
export function rereadAllowanceUsd(now: number, p: Policy): number {
  const d = p.feed.searchDay;
  if (!d.on) return Number.POSITIVE_INFINITY;
  const sinceStart = now - searchDayStart(now, p);
  return d.rereadDailyUsd * Math.min(1, (sinceStart + Math.max(0, d.aheadMs)) / MS_PER_DAY);
}

/** True when an ask quoted at `askUsd` keeps the day's X search at or under its allowance now. */
export function searchDayMayAsk(spentUsd: number, askUsd: number, now: number, p: Policy): boolean {
  if (!p.feed.searchDay.on) return true;
  if (!Number.isFinite(spentUsd) || !Number.isFinite(askUsd)) return false;
  return spentUsd + Math.max(0, askUsd) <= searchDayAllowanceUsd(now, p);
}
