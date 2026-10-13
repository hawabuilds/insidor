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

import { MS_PER_DAY, MS_PER_MINUTE } from '../math.ts';

export type LaneFloors = Readonly<Record<FeedLane, number>>;

export function startFloors(p: Policy): LaneFloors {
  return { all: p.feed.startFloor, media: p.feed.mediaStartFloor, slow: p.feed.startFloor * p.feed.slow.floorMultiple };
}

/** How far back a lane looks, in minutes. */
export function laneWindowMin(lane: FeedLane, p: Policy): number {
  return lane === 'slow' ? p.feed.slow.windowMin : p.feed.windowMin;
}

/**
 * The floor actually sent for one lane: the base scaled down for a window shorter than the
 * full one, because a younger post has had less time to collect approvals. The slow lane's
 * is never below `slow.floorMultiple` × what the main lane sends, so it keeps asking for
 * the posts that kept going however low its own floor has adapted.
 */
export function effectiveFloor(lane: FeedLane, floors: LaneFloors, p: Policy): number {
  const scaled = scaledFloor(floors[lane], laneWindowMin(lane, p), p);
  if (lane !== 'slow') return scaled;
  return Math.min(Math.max(scaled, scaledFloor(floors.all, p.feed.windowMin, p) * p.feed.slow.floorMultiple), p.feed.floorMax);
}

/**
 * ★ A FRESH BAND'S FLOOR (`feed.fresh`): the 'all' lane's base, scaled to the age the band looks
 * at — the same scaling the main window gets, so a post climbing at the same pace clears every
 * band. A band at the full window or older asks the base in full.
 */
export function bandFloor(ageMin: number, floors: LaneFloors, p: Policy): number {
  return scaledFloor(floors.all, ageMin, p);
}

/**
 * The posting-time window one fresh band asks this pass: from where its last answered ask ended
 * to `ageMin` minutes before now, so consecutive asks tile time with no gap and no overlap. With
 * no earlier ask (a start), or one further back than `fresh.maxWindowMin`, it reaches back that
 * far and no further. Null when there is nothing new to ask (the last ask already ended there).
 *
 * What breaks if changed carelessly: starting a window before `lastUntil` re-buys posts the band
 * already returned; starting it after leaves posts no band ever looks at at this age.
 */
export function bandWindow(ageMin: number, lastUntil: number | null, now: number, p: Policy): { readonly since: number; readonly until: number } | null {
  const until = now - ageMin * MS_PER_MINUTE;
  const earliest = until - p.feed.fresh.maxWindowMin * MS_PER_MINUTE;
  const since = lastUntil === null ? earliest : Math.max(lastUntil, earliest);
  return since < until ? { since, until } : null;
}

/**
 * Whether a slow-lane slice is already covered by the fresh bands: its youngest age is no older
 * than the oldest band, so the band has looked at those posts at about that age.
 */
export function sliceCoveredByBands(youngestAgeMin: number, p: Policy): boolean {
  if (!p.feed.fresh.enabled) return false;
  return youngestAgeMin <= Math.max(0, ...p.feed.fresh.bandAgesMin);
}

function scaledFloor(base: number, windowMin: number, p: Policy): number {
  const f = p.feed;
  const kept = Math.min(Math.max(base, f.floorMin), f.floorMax);
  const scaled = Math.round(kept * Math.min(windowMin / f.fullWindowMin, 1));
  return Math.min(Math.max(scaled, f.effectiveFloorMin), f.floorMax);
}

/** Every lane's sent floor. */
export function sentFloors(floors: LaneFloors, p: Policy): LaneFloors {
  return { all: effectiveFloor('all', floors, p), media: effectiveFloor('media', floors, p), slow: effectiveFloor('slow', floors, p) };
}

/**
 * Posts per pass each lane is aimed at, so that a day of passes spends the catch-all's
 * share of the daily budget and no more. The slow lane runs on its own, slower clock, so
 * its per-pass target is its share over its own passes. With `feed.fresh` on, the media lane's
 * money goes to the bands' 'all' target, scaled by `fresh.targetScale`.
 *
 * @param usdPerPost what the source bills for one post returned
 * @param passesPerDay how many main discovery passes a day holds at the current cadence
 */
export function laneTargets(dailyCapUsd: number, usdPerPost: number, passesPerDay: number, p: Policy): LaneFloors {
  if (usdPerPost <= 0 || passesPerDay <= 0) return { all: 0, media: 0, slow: 0 };
  const posts = (dailyCapUsd * p.feed.budgetShare) / usdPerPost;
  const perPass = (posts * (1 - p.feed.slow.share)) / passesPerDay;
  const media = perPass * p.feed.mediaShare;
  const slowPassesPerDay = MS_PER_DAY / p.feed.slow.everyMs;
  const slow = (posts * p.feed.slow.share) / slowPassesPerDay;
  /* Fresh bands (`feed.fresh`) replace both main lanes: they steer the 'all' floor toward both
     lanes' money, less the share that pays for the longer re-reads. The media lane is not asked. */
  if (p.feed.fresh.enabled) return { all: perPass * p.feed.fresh.targetScale, media: 0, slow };
  return { all: perPass - media, media, slow };
}

/**
 * Whether the slow lane is due on a pass at `now`, given when it last ran (null: never in
 * this process, so it runs on the first pass after a start).
 */
export function slowLaneDue(now: number, lastRanAt: number | null, p: Policy): boolean {
  return lastRanAt === null || now - lastRanAt >= p.feed.slow.everyMs;
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
