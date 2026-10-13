/**
 * THE RECALL MODEL: given a post and today's discovery settings, would a catch-all lane have
 * returned it, and how many minutes after it was posted?
 *
 * Used twice: the gold set's recall report (eval/src/gold/run-recall.ts), which asks it of every
 * founder-labelled origin post, and the daily check (tools/recall-check.ts), which asks it only to
 * NAME the reason for a post we did not have. The daily check's caught/not-caught is never the
 * model's — it is what public.item held — so the model can only be wrong about why, never about
 * whether.
 *
 * ── HOW A LANE CATCHES A POST ─────────────────────────────────────────────
 *
 * A lane asks, every `everyMin`, for posts newer than its window that already carry `floor`
 * approvals, newest first, a capped number of results. So a post is caught by a lane when, at a
 * pass, it is (a) a post the query matches at all — the language, an original rather than a reply
 * or a repost, a picture for the media lane; (b) over the floor; and (c) still young enough that
 * the lane reaches back to it. (c) is `reachMin`, MEASURED from the ages at which the lane really
 * found its posts, not the window it asked for: a lane whose result cap fills before the window
 * ends reaches only as far back as its last result (store/src/repo/recall.ts says why).
 *
 * ── THE ASSUMPTION EVERYTHING HERE RESTS ON ───────────────────────────────
 *
 * We do not have a post's approval history, only its count when we read it. So approvals are
 * assumed to grow as `final × (1 − e^(−age/τ))`, with τ fitted to our own readings of live posts
 * (`fitGrowthTau`), and the count read now is taken as `final`. Then the age at which a post
 * crossed a floor is `−τ·ln(1 − floor/final)`, and the first pass after that is, on average, half
 * a pass later. A post that grew slower than τ says (most viral posts keep growing for days) is
 * credited too early here — the report reruns at a slower τ to show how much that moves.
 *
 * What breaks if changed carelessly: MISS_REASONS is also the CHECK list of 0047; the test beside
 * this file keeps them equal. And the reason ORDER in `classify` is the claim: a post not in the
 * search is that before it is anything else, because no floor or cadence would have changed it.
 */

/** Why a post was not caught. The first three say the question could not be asked of X at all. */
export const MISS_REASONS = [
  'not_on_x',
  'launch_unknown',
  'posted_after_launch',
  'discovery_off',
  'deleted',
  'not_in_search',
  'under_floor',
  'between_checks',
  'post_unread',
] as const;
export type MissReason = (typeof MISS_REASONS)[number];

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
  /** Replies and reposts are excluded by the query. */
  readonly originalsOnly: boolean;
  /** Minutes: the growth curve's time constant. */
  readonly tauMin: number;
}

/** What we know about one post, as read. */
export interface PostFacts {
  /** Approvals when read — taken as the post's final count. */
  readonly approvals: number;
  readonly lang: string | null;
  readonly hasMedia: boolean;
  /** A reply or a repost: what an originals-only query never returns. */
  readonly notOriginal: boolean;
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
  if (s.langs !== null && (post.lang === null || !s.langs.includes(post.lang))) return false;
  if (s.originalsOnly && post.notOriginal) return false;
  if (lane !== null && lane.mediaOnly && !post.hasMedia) return false;
  return true;
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

/** The median of a list, or null when it is empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}
