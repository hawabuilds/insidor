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
 * ★ PER LANGUAGE (`feed.langSplit`): whether the split is in force — on, with the fresh bands on.
 */
export function langSplitOn(p: Policy): boolean {
  return p.feed.langSplit.on && p.feed.fresh.enabled;
}

/** A language's share of the bands' money: its `shares` entry over the entries of `feed.langs`. 0 for one not listed. */
export function langShare(lang: string, p: Policy): number {
  const shares = p.feed.langSplit.shares;
  const total = p.feed.langs.reduce((sum, l) => sum + Math.max(0, shares[l] ?? 0), 0);
  return total > 0 ? Math.max(0, shares[lang] ?? 0) / total : 0;
}

/** Posts a day a language's share of `langSplit.bandsDailyUsd` buys, at `usdPerPost`. */
export function langPostsPerDay(lang: string, usdPerPost: number, p: Policy): number {
  if (!(usdPerPost > 0)) return 0;
  return (p.feed.langSplit.bandsDailyUsd * langShare(lang, p)) / usdPerPost;
}

/**
 * How often a language is asked on each band: when its share has bought `minPostsPerAsk` posts a
 * band since the last ask, and never less often than `maxEveryMs`. A language whose share buys that
 * every pass gets a spacing shorter than a pass, so it is asked every pass.
 */
export function langEveryMs(lang: string, usdPerPost: number, p: Policy): number {
  const s = p.feed.langSplit;
  const perDay = langPostsPerDay(lang, usdPerPost, p);
  if (!(perDay > 0)) return s.maxEveryMs;
  const bands = Math.max(1, p.feed.fresh.bandAgesMin.length);
  return Math.min(s.maxEveryMs, Math.ceil((MS_PER_DAY * bands * Math.max(0, s.minPostsPerAsk)) / perDay));
}

/**
 * One language's band window this pass (`feed.langSplit`): like `bandWindow`, but only once it spans
 * `everyMs` of posting time (null before), and reaching back `everyMs` beyond `fresh.maxWindowMin` so
 * a language asked every half hour is not cut to the last quarter-hour. A first ask (no `lastUntil`)
 * reaches back `fresh.maxWindowMin`, as a band's does, and goes at once.
 *
 * What breaks if changed carelessly: a cap on the reach-back shorter than `everyMs` leaves posts no
 * ask of that language ever looks at.
 */
export function langBandWindow(ageMin: number, lastUntil: number | null, now: number, everyMs: number, p: Policy): { readonly since: number; readonly until: number } | null {
  const until = now - ageMin * MS_PER_MINUTE;
  const reach = p.feed.fresh.maxWindowMin * MS_PER_MINUTE;
  if (lastUntil === null) return { since: until - reach, until };
  const since = Math.max(lastUntil, until - reach - Math.max(0, everyMs));
  if (until - since < Math.max(0, everyMs) || since >= until) return null;
  return { since, until };
}

/**
 * A language's target this pass: the posts its share buys a day, over the minutes of posting time
 * its band asks covered (`windowMin`, summed over the bands), as a share of the day's — each band
 * tiles the whole day once, so a day of asks covers `bands` days of minutes.
 */
export function langTarget(postsPerDay: number, windowMin: number, p: Policy): number {
  const bands = Math.max(1, p.feed.fresh.bandAgesMin.length);
  return (Math.max(0, postsPerDay) * Math.max(0, windowMin)) / (bands * (MS_PER_DAY / MS_PER_MINUTE));
}

/**
 * Whether a slow-lane slice is already covered by the fresh bands: its youngest age is no older
 * than the oldest band, so the band has looked at those posts at about that age.
 */
export function sliceCoveredByBands(youngestAgeMin: number, p: Policy): boolean {
  if (!p.feed.fresh.enabled) return false;
  return youngestAgeMin <= Math.max(0, ...p.feed.fresh.bandAgesMin);
}

/**
 * ★ THE LATE BANDS (`feed.fresh.late`), when they are asked: only with the fresh bands on and the
 * late switch on. Empty otherwise, so every caller can loop over them unconditionally.
 */
export function lateBands(p: Policy): readonly { readonly ageMin: number; readonly minApproval: number }[] {
  return p.feed.fresh.enabled && p.feed.fresh.late.on ? p.feed.fresh.late.bands : [];
}

/**
 * A late band's sent floor: its own fixed floor, but never above what the slow lane sends. The
 * slow lane's slice at the band's age is dropped (`sliceCoveredByLateBand`), so a band asking for
 * MORE likes than the slice would have would lose the posts in between.
 */
export function lateBandFloor(minApproval: number, floors: LaneFloors, p: Policy): number {
  return Math.max(p.feed.effectiveFloorMin, Math.min(Math.round(minApproval), effectiveFloor('slow', floors, p)));
}

/**
 * Whether a slow-lane slice — the posts aged `youngestAgeMin` to `youngestAgeMin + widthMin` — is
 * covered by a late band: the band's age falls inside it, so the band has asked for the same posts
 * at about the same age at a floor no higher (`lateBandFloor`).
 *
 * What breaks if changed carelessly: dropping a slice the band does not cover leaves an hour of age
 * the slow lane never looks at.
 */
export function sliceCoveredByLateBand(youngestAgeMin: number, widthMin: number, p: Policy, floors?: LaneFloors, sliceFloorSent?: number): boolean {
  /* With the slice's own floor given (`slow.ageScaledFloor` sends each slice less than the lane's
     floor), the band covers it only when the band's floor is no higher than the slice's. */
  const noHigher = (minApproval: number): boolean => floors === undefined || sliceFloorSent === undefined || lateBandFloor(minApproval, floors, p) <= sliceFloorSent;
  return lateBands(p).some((b) => b.ageMin > youngestAgeMin && b.ageMin <= youngestAgeMin + widthMin && noHigher(b.minApproval));
}

/**
 * ★ ONE SLOW SLICE'S FLOOR (`slow.ageScaledFloor`): the slow lane's sent floor scaled to the slice's
 * age over the lane's window, as a fresh band's is scaled to its age over the full window
 * (`bandFloor`), so the two-hour slice asks a third of what the six-hour one does. Off, every slice
 * asks the lane's floor, as before.
 *
 * Why: at one floor for every age the oldest slice took the lane's money — on 25 Oct 03:50–12:00
 * UTC the slices at two, three, four and six hours returned 3.4, 5.8, 9.2 and 21.0 posts a pass —
 * and a post found at six hours is at For You's own age limit (`rising.fypMaxAgeMs`). The lane's
 * floor adapts to the same target either way, so the money does not move; it is spent on the same
 * kind of post found hours sooner.
 *
 * What breaks if changed carelessly: scaling the floor without letting the lane's floor adapt to
 * the scaled slices' total would multiply the lane's posts several times over at the young slices.
 */
export function sliceFloor(sentFloor: number, oldestAgeMin: number, p: Policy): number {
  if (!p.feed.slow.ageScaledFloor) return sentFloor;
  const share = Math.min(Math.max(oldestAgeMin, 0) / Math.max(p.feed.slow.windowMin, 1), 1);
  return Math.max(p.feed.effectiveFloorMin, Math.round(sentFloor * share));
}

/**
 * ★ ONE SLOW SLICE'S POSTING-TIME WINDOW, tiled like a fresh band's (`bandWindow`): from where that
 * slice's last answered ask ended to `youngestAgeMin` before now, so consecutive slow passes leave no
 * gap at that age. With no earlier ask (a start) it is the slice's own width; it never reaches back
 * further than the distance between two slices (`slow.windowMin / slow.slices`). Null when there is
 * nothing new to ask.
 *
 * Why: the slices were anchored to now and `slow.everyMs` wide, and the slow passes come every 15 to
 * 17 minutes, so a minute or two of posting time went unasked at every age on every pass, and a late
 * pass left more (24 Oct: the slow lane's finds show no pass between 11:28 and 12:08 UTC, so posts of
 * 05:43 to 06:08 were most likely never asked at six hours — a 1.96M-view post of 06:00 among them).
 *
 * What breaks if changed carelessly: starting before `lastUntil` re-buys posts the slice already
 * returned; capping the reach-back below a pass's spacing brings the gaps back.
 */
export function sliceWindow(youngestAgeMin: number, widthMin: number, lastUntil: number | null, now: number, p: Policy): { readonly since: number; readonly until: number } | null {
  const until = now - youngestAgeMin * MS_PER_MINUTE;
  const step = (p.feed.slow.windowMin / Math.max(1, Math.floor(p.feed.slow.slices))) * MS_PER_MINUTE;
  const since = lastUntil === null ? until - widthMin * MS_PER_MINUTE : Math.max(lastUntil, until - step);
  return since < until ? { since, until } : null;
}

/**
 * ★ THE MIDDLE LANE (`feed.middle`): the posting-time window it asks this pass, `maxAgeMin` to
 * `minAgeMin` minutes before now, whole. Not tiled like the bands: see the field's note.
 */
export function middleWindow(now: number, p: Policy): { readonly since: number; readonly until: number } {
  const m = p.feed.middle;
  return { since: now - m.maxAgeMin * MS_PER_MINUTE, until: now - m.minAgeMin * MS_PER_MINUTE };
}

/** Whether the middle lane is due: never asked in this process, or `middle.everyMs` since it was. False while off. */
export function middleLaneDue(now: number, lastRanAt: number | null, p: Policy): boolean {
  if (!p.feed.middle.on) return false;
  return lastRanAt === null || now - lastRanAt >= p.feed.middle.everyMs;
}

/**
 * Whether a slow-lane slice — the posts aged `youngestAgeMin` to `youngestAgeMin + widthMin` — lies
 * wholly inside the middle lane's window, which asks those posts at a floor no higher than the slow
 * lane sends (`slowSentFloor`). Then the slice buys nothing the middle lane has not.
 *
 * What breaks if changed carelessly: dropping a slice when the middle floor is the higher one loses
 * the posts between the two floors at that age.
 */
export function sliceCoveredByMiddle(youngestAgeMin: number, widthMin: number, slowSentFloor: number, p: Policy): boolean {
  const m = p.feed.middle;
  if (!m.on || m.minApproval > slowSentFloor) return false;
  return youngestAgeMin >= m.minAgeMin && youngestAgeMin + widthMin <= m.maxAgeMin;
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
  /* Its own money a day when set (`slow.dailyUsd`), else its share of the line. */
  const slow = ((p.feed.slow.dailyUsd === null ? posts * p.feed.slow.share : p.feed.slow.dailyUsd / usdPerPost)) / slowPassesPerDay;
  /* Fresh bands (`feed.fresh`) replace both main lanes: they steer the 'all' floor toward both
     lanes' money, less the share that pays for the longer re-reads. The media lane is not asked. */
  if (p.feed.fresh.enabled) return { all: perPass * p.feed.fresh.targetScale, media: 0, slow };
  return { all: perPass - media, media, slow };
}

/** The languages the slow lane and the late bands ask (`slow.langs`), each its own search; `feed.langs` when unset. */
export function slowLangs(p: Policy): readonly string[] {
  return p.feed.slow.langs ?? p.feed.langs;
}

/**
 * Whether the slow lane is due on a pass at `now`, given when it last ran (null: never in
 * this process, so it runs on the first pass after a start).
 */
export function slowLaneDue(now: number, lastRanAt: number | null, p: Policy): boolean {
  return lastRanAt === null || now - lastRanAt >= p.feed.slow.everyMs;
}

export type FloorMove = 'empty' | 'held_other_lane_empty' | 'raised' | 'lowered' | 'held' | 'cut';

/**
 * One lane's next base floor, from that lane's own result.
 *
 *   cut short by money         raise by `raiseFactor` — what it returned is a truncated count
 *   returned nothing           lower by `emptyFactor` at once — the floor is shutting it out
 *   the other lane was empty   hold — never raise while either lane is starving
 *   over its target            raise by `raiseFactor`
 *   under `lowBand` × target   lower by `lowerFactor`
 *   otherwise                  hold
 *
 * ★ `cut`: the search stopped this language with more to read because a day ran out (its own,
 * the X search day's, the meter's). Its count is then only what the money reached, which can sit
 * under the target and LOWER a floor that is already letting in more than the day buys — and the
 * day, not the floor, goes on deciding which posts are read, newest first, with the older part of
 * each window never asked. Raising instead hands the steering back to the floor until the window
 * fits the day.
 */
export function nextFloor(
  base: number,
  returned: number,
  target: number,
  otherLaneEmpty: boolean,
  p: Policy,
  cut = false,
): { readonly floor: number; readonly move: FloorMove } {
  const f = p.feed;
  if (cut) return { floor: Math.min(f.floorMax, Math.ceil(base * f.raiseFactor)), move: 'cut' };
  if (returned === 0) return { floor: Math.max(f.floorMin, Math.floor(base * f.emptyFactor)), move: 'empty' };
  if (otherLaneEmpty) return { floor: base, move: 'held_other_lane_empty' };
  if (returned > target) return { floor: Math.min(f.floorMax, Math.ceil(base * f.raiseFactor)), move: 'raised' };
  if (returned < target * f.lowBand) return { floor: Math.max(f.floorMin, Math.floor(base * f.lowerFactor)), move: 'lowered' };
  return { floor: base, move: 'held' };
}
