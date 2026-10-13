/**
 * THE RECALL MODEL: given a post and today's discovery settings, would a catch-all lane have
 * returned it, and how many minutes after it was posted?
 *
 * Moved here from eval/src/recall/model.ts (which re-exports it, with the reason list and the
 * report's helpers) when the runner needed it too: the owner's missed posts are diagnosed with it
 * the minute they are pasted (core/src/learning/missed.ts), and a service may import core but not
 * eval. One copy, so the daily recall check, the gold report and a missed post's diagnosis can
 * never disagree about why a post was not caught.
 *
 * ── HOW A LANE CATCHES A POST ─────────────────────────────────────────────
 *
 * A lane asks, every `everyMin`, for posts newer than its window that already carry `floor`
 * approvals, newest first, a capped number of results. So a post is caught by a lane when, at a
 * pass, it is (a) a post the query matches at all — the language, not a plain repost (and not a
 * reply, when replies are left out), a picture for the media lane; (b) over the floor; and (c)
 * still young enough that the lane reaches back to it. (c) is `reachMin`, MEASURED from the ages
 * at which the lane really found its posts, not the window it asked for: a lane whose result cap
 * fills before the window ends reaches only as far back as its last result.
 *
 * ── THE ASSUMPTION EVERYTHING HERE RESTS ON ───────────────────────────────
 *
 * We do not have a post's approval history, only its count when we read it. So approvals are
 * assumed to grow as `final × (1 − e^(−age/τ))`, with τ fitted to our own readings of live posts
 * (`fitGrowthTau`), and the count read now is taken as `final`. Then the age at which a post
 * crossed a floor is `−τ·ln(1 − floor/final)`, and the first pass after that is, on average, half
 * a pass later. A post that grew slower than τ says is credited too early here.
 *
 * What breaks if changed carelessly: the reason ORDER in `verdict` is the claim. A post not in the
 * search is that before it is anything else, because no floor or cadence would have changed it.
 */

export interface LaneSetting {
  readonly lane: string;
  /** Approvals the query asks for, as sent. */
  readonly floor: number;
  /** How far back, in minutes of a post's age, the lane really reaches. */
  readonly reachMin: number;
  /** Minutes between two passes of this lane. */
  readonly everyMin: number;
  readonly mediaOnly: boolean;
}

export interface DiscoverySettings {
  readonly lanes: readonly LaneSetting[];
  /** The languages a catch-all query accepts, as the source tags them, or null for any. */
  readonly langs: readonly string[] | null;
  /** Replies are left out by the query. No longer, since 2026-10-13: replies are searched. */
  readonly excludeReplies: boolean;
  /** Plain reposts are left out by the query. */
  readonly excludeRebroadcasts: boolean;
  /** Minutes: the growth curve's time constant. */
  readonly tauMin: number;
}

/** What we know about one post, as read. */
export interface PostFacts {
  /** Approvals when read — taken as the post's final count. */
  readonly approvals: number;
  readonly lang: string | null;
  readonly hasMedia: boolean;
  /** A reply: returned unless the query leaves replies out. */
  readonly isReply: boolean;
  /** A plain repost: the same post re-shown, which the query leaves out. */
  readonly isRebroadcast: boolean;
}

export type Verdict =
  | { readonly kind: 'caught'; readonly lane: string; readonly delayMin: number }
  | { readonly kind: 'missed'; readonly reason: 'not_in_search' | 'under_floor' | 'between_checks' };

/** Approvals at `ageMin`, on the assumed curve. */
export function approvalsAt(final: number, ageMin: number, tauMin: number): number {
  return ageMin <= 0 ? 0 : final * (1 - Math.exp(-ageMin / tauMin));
}

/** The age at which a post with `final` approvals crossed `floor`, or null when it never did. */
export function crossingAgeMin(final: number, floor: number, tauMin: number): number | null {
  if (final < floor || final <= 0) return null;
  if (final === floor) return Number.POSITIVE_INFINITY;
  return -tauMin * Math.log(1 - floor / final);
}

/** Whether the query a lane sends would match this post at all, approvals aside. */
export function inSearch(post: PostFacts, lane: LaneSetting | null, s: DiscoverySettings): boolean {
  return searchFilter(post, lane, s) === null;
}

/** Which part of the query leaves this post out, or null when it matches. */
export function searchFilter(post: PostFacts, lane: LaneSetting | null, s: DiscoverySettings): 'language' | 'reply' | 'repost' | 'media' | null {
  if (s.langs !== null && (post.lang === null || !s.langs.includes(post.lang))) return 'language';
  if (s.excludeReplies && post.isReply) return 'reply';
  if (s.excludeRebroadcasts && post.isRebroadcast) return 'repost';
  if (lane !== null && lane.mediaOnly && !post.hasMedia) return 'media';
  return null;
}

/**
 * The earliest lane to catch this post and the minutes after posting, or the reason none did.
 * The first pass after a crossing is taken at half a pass — the expected wait for a post made at
 * a random moment — and a lane catches only if that pass is still within its reach.
 */
export function verdict(post: PostFacts, s: DiscoverySettings): Verdict {
  if (!inSearch(post, null, s)) return { kind: 'missed', reason: 'not_in_search' };
  let best: { lane: string; delayMin: number } | null = null;
  let crossedAny = false;
  for (const lane of s.lanes) {
    if (!inSearch(post, lane, s)) continue;
    const at = crossingAgeMin(post.approvals, lane.floor, s.tauMin);
    if (at === null) continue;
    crossedAny = true;
    const seen = at + lane.everyMin / 2;
    if (seen > lane.reachMin) continue;
    if (best === null || seen < best.delayMin) best = { lane: lane.lane, delayMin: seen };
  }
  if (best !== null) return { kind: 'caught', ...best };
  return { kind: 'missed', reason: crossedAny ? 'between_checks' : 'under_floor' };
}

/**
 * Why a post we did not have before a launch was missed, given its age at the launch: the same
 * order as `verdict`, but a floor counts as crossed only if it was crossed BEFORE the launch.
 */
export function missReasonBefore(post: PostFacts, ageAtLaunchMin: number, s: DiscoverySettings): 'not_in_search' | 'under_floor' | 'between_checks' {
  if (!inSearch(post, null, s)) return 'not_in_search';
  const atLaunch = approvalsAt(post.approvals, ageAtLaunchMin, s.tauMin);
  const crossed = s.lanes.some((lane) => inSearch(post, lane, s) && atLaunch >= lane.floor);
  return crossed ? 'between_checks' : 'under_floor';
}

/**
 * τ, in minutes, that best explains how our own posts grew between their first and last reading:
 * least squares on the log of the ratio, over a geometric grid. Null with no pairs to fit.
 */
export function fitGrowthTau(
  pairs: readonly { readonly ageFirstMin: number; readonly approvalsFirst: number; readonly ageLastMin: number; readonly approvalsLast: number }[],
  grid: { readonly fromMin: number; readonly toMin: number; readonly step: number },
): number | null {
  const usable = pairs.filter((p) => p.ageFirstMin > 0 && p.ageLastMin > p.ageFirstMin && p.approvalsFirst > 0 && p.approvalsLast > 0);
  if (usable.length === 0) return null;
  let best: { tau: number; err: number } | null = null;
  for (let tau = grid.fromMin; tau <= grid.toMin; tau *= grid.step) {
    let err = 0;
    for (const p of usable) {
      const model = Math.log((1 - Math.exp(-p.ageFirstMin / tau)) / (1 - Math.exp(-p.ageLastMin / tau)));
      const seen = Math.log(p.approvalsFirst / p.approvalsLast);
      err += (model - seen) ** 2;
    }
    if (best === null || err < best.err) best = { tau, err };
  }
  return best?.tau ?? null;
}
