/**
 * WAS DISCOVERY RUNNING WHEN THIS POST COULD HAVE BEEN FOUND? The stretches with no working search
 * pass, and whether a post's chance to be found fell inside one.
 *
 * Its own file, apart from the diagnosis, because two callers must agree on what an outage is: the
 * missed-post diagnosis the minute a link is pasted (learning/missed.ts, fed by the runner), and
 * the replay a person runs over every missed post (tools/missed-replay.ts). Pure, in core: the
 * caller reads when passes stored posts; this file only names the gaps and measures a post's
 * window against them.
 *
 * ★ A PASS IS A PASS THAT STORED SOMETHING. A search that was paid for but whose posts never
 * reached the database (the 00:08–02:04 UTC outage on 2026-10-13 kept searching until 00:49 with
 * the pool full) found nothing we can show, so the caller feeds the times posts were STORED as
 * found, not the times money was spent.
 *
 * ★ AN OUTAGE IS A GAP LONGER THAN THE MAIN LANE LOOKS BACK. The main lanes look back
 * `feed.windowMin`; a gap shorter than that still had every post in some pass's window, so it
 * only thinned the chances. A longer gap left posts no pass ever asked about. Before the first pass
 * on record discovery was not running at all, and a post from then is told so, never "unexplained".
 *
 * ★ DOWN MEANS THE MAIN WINDOW WAS WHOLLY DOWN. The main lanes find nearly every post; the slow
 * lane, capped at its newest results, reaches back about an hour at best. A post whose first
 * `windowMin` minutes all fell in an outage is `down` even if a slow pass ran near the far end of
 * its reach; how many minutes of that reach were up is kept beside it, so the claim can be checked.
 *
 * What breaks if changed carelessly: the gap bar. Set it below the main lanes' cadence and every
 * late pass is an outage; set it above the look-back and an hour with no search hides as "up".
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { MS_PER_MINUTE } from '../math.ts';

/** A stretch with no working pass. `fromMs` null: before the first pass on record; `toMs` null: still down now. */
export interface Outage {
  readonly fromMs: number | null;
  readonly toMs: number | null;
}

/** When passes stored posts: the first, the last, and every gap between two that is longer than the bar. */
export interface PassRecord {
  readonly firstMs: number | null;
  readonly lastMs: number | null;
  readonly gaps: readonly { readonly fromMs: number; readonly toMs: number }[];
}

/** The longest gap that is not an outage: the main lanes' look-back. */
export const outageGapMs = (p: Policy): number => p.feed.windowMin * MS_PER_MINUTE;

/** Every outage on record, oldest first: before the first pass, the long gaps, and now if the last pass is old. */
export function outages(r: PassRecord, nowMs: number, p: Policy): readonly Outage[] {
  if (r.firstMs === null || r.lastMs === null) return [{ fromMs: null, toMs: null }];
  const bar = outageGapMs(p);
  const out: Outage[] = [{ fromMs: null, toMs: r.firstMs }];
  for (const g of [...r.gaps].sort((a, b) => a.fromMs - b.fromMs)) if (g.toMs - g.fromMs > bar) out.push({ fromMs: g.fromMs, toMs: g.toMs });
  if (nowMs - r.lastMs > bar) out.push({ fromMs: r.lastMs, toMs: null });
  return out;
}

/** Minutes of [fromMs, toMs] that fall inside an outage. */
function downMinutes(list: readonly Outage[], fromMs: number, toMs: number): number {
  let down = 0;
  for (const o of list) {
    const a = Math.max(fromMs, o.fromMs ?? Number.NEGATIVE_INFINITY);
    const b = Math.min(toMs, o.toMs ?? Number.POSITIVE_INFINITY);
    if (b > a) down += b - a;
  }
  return down / MS_PER_MINUTE;
}

export interface PostWindow {
  /** The outage the post was made in, or null when discovery was up at that moment. */
  readonly postedIn: Outage | null;
  /** Discovery had not yet run at all when the post was made. */
  readonly beforeFirstPass: boolean;
  /** Minutes of the main lanes' window after posting with discovery up, of `windowMin`. */
  readonly coveredMin: number;
  readonly windowMin: number;
  /** Minutes of the slow lane's real reach after posting with discovery up, of `slowReachMin`. */
  readonly slowCoveredMin: number;
  readonly slowReachMin: number;
  /** No minute of the main window had discovery up. */
  readonly down: boolean;
}

/**
 * How much of a post's chance to be found discovery was up for. `slowReachMin` is how far back the
 * slow lane really reaches (measured), not the window it asks for.
 */
export function postWindow(list: readonly Outage[], postedAtMs: number, slowReachMin: number, p: Policy): PostWindow {
  const windowMin = p.feed.windowMin;
  const end = postedAtMs + windowMin * MS_PER_MINUTE;
  const slowEnd = postedAtMs + slowReachMin * MS_PER_MINUTE;
  const postedIn = list.find((o) => (o.fromMs ?? Number.NEGATIVE_INFINITY) <= postedAtMs && postedAtMs < (o.toMs ?? Number.POSITIVE_INFINITY)) ?? null;
  const coveredMin = windowMin - downMinutes(list, postedAtMs, end);
  const slowCoveredMin = slowReachMin - downMinutes(list, postedAtMs, slowEnd);
  return {
    postedIn,
    beforeFirstPass: postedIn !== null && postedIn.fromMs === null,
    coveredMin,
    windowMin,
    slowCoveredMin,
    slowReachMin,
    down: coveredMin <= 0,
  };
}
