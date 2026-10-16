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

import type { LaneCapPolicy } from '@insidor/contracts/policy.ts';

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
