/**
 * The approval floor on the catch-all search, and how it moves.
 *
 * A search with no keyword returns everything in the language; the floor — "only posts
 * with at least N approvals" — is the one lever that decides how much of that we pay for.
 * So it is moved by the money: each lane has a target of posts per pass, derived from the
 * daily budget, and after every pass its floor moves toward the target from that lane's own
 * result. Ported from the earlier build's adaptive lane floors, with its numbers in policy.
 *
 * Pure, and in core rather than the runner, because the moves are thresholds and every
 * threshold lives in policy and is applied here. The runner reads and stores the floors.
 *
 * What breaks if changed carelessly: the floor is a cost control, not a judgement. Folding
 * a quality idea into it ("raise it, the posts look weak") would turn a budget lever into an
 * unlogged admission rule — ADMIT is where posts are judged, on rates.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import type { FeedLane } from '@insidor/contracts/ports/platform.ts';

export type LaneFloors = Readonly<Record<FeedLane, number>>;

export function startFloors(p: Policy): LaneFloors {
  return { all: p.feed.startFloor, media: p.feed.mediaStartFloor };
}

/**
 * The floor actually sent: the base scaled down for a window shorter than the full one,
 * because a younger post has had less time to collect approvals.
 */
export function effectiveFloor(base: number, p: Policy): number {
  const f = p.feed;
  const kept = Math.min(Math.max(base, f.floorMin), f.floorMax);
  const scaled = Math.round(kept * Math.min(f.windowMin / f.fullWindowMin, 1));
  return Math.min(Math.max(scaled, f.effectiveFloorMin), f.floorMax);
}

/**
 * Posts per pass each lane is aimed at, so that a day of passes spends the catch-all's
 * share of the daily budget and no more.
 *
 * @param usdPerPost what the source bills for one post returned
 * @param passesPerDay how many discovery passes a day holds at the current cadence
 */
export function laneTargets(dailyCapUsd: number, usdPerPost: number, passesPerDay: number, p: Policy): LaneFloors {
  if (usdPerPost <= 0 || passesPerDay <= 0) return { all: 0, media: 0 };
  const perPass = (dailyCapUsd * p.feed.budgetShare) / usdPerPost / passesPerDay;
  const media = perPass * p.feed.mediaShare;
  return { all: perPass - media, media };
}

export type FloorMove = 'empty' | 'held_other_lane_empty' | 'raised' | 'lowered' | 'held';

/**
 * One lane's next base floor, from that lane's own result.
 *
 *   returned nothing           lower by `emptyFactor` at once — the floor is shutting it out
 *   the other lane was empty   hold — never raise while either lane is starving
 *   over its target            raise by `raiseFactor`
 *   under `lowBand` × target   lower by `lowerFactor`
 *   otherwise                  hold
 */
export function nextFloor(
  base: number,
  returned: number,
  target: number,
  otherLaneEmpty: boolean,
  p: Policy,
): { readonly floor: number; readonly move: FloorMove } {
  const f = p.feed;
  if (returned === 0) return { floor: Math.max(f.floorMin, Math.floor(base * f.emptyFactor)), move: 'empty' };
  if (otherLaneEmpty) return { floor: base, move: 'held_other_lane_empty' };
  if (returned > target) return { floor: Math.min(f.floorMax, Math.ceil(base * f.raiseFactor)), move: 'raised' };
  if (returned < target * f.lowBand) return { floor: Math.max(f.floorMin, Math.floor(base * f.lowerFactor)), move: 'lowered' };
  return { floor: base, move: 'held' };
}
