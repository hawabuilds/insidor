/**
 * ★ WHICH CLOCK A STORY'S COIN WINDOW HANGS ON, AND WHAT THAT COSTS.
 *
 * db.ts narrows the mint stream to a window before coins.ts applies the text tests. This
 * file decides where that window sits. It is a separate file, pure, with no database in
 * it, because it is the one part of retrieval that is a JUDGEMENT rather than a fetch —
 * and a judgement expressed as a `coalesce` inside a SQL string literal is a judgement no
 * test can call with a literal and no reader can find.
 *
 * ★ THE WHOLE POINT: TWO WINDOWS THAT LOOK ALIKE AND MEAN DIFFERENT THINGS.
 *
 *   EARLIEST_POST — anchored on `min(public.item.posted_at)`, when a person posted.
 *     This window is an ORDERING CLAIM. A coin minted before the earliest post cannot
 *     have been minted from it; that is resolve's first and cheapest gate and no amount
 *     of name similarity overturns it. The window therefore opens AT the anchor and only
 *     runs forward.
 *
 *   FIRST_SIGHT — anchored on `min(public.item.first_seen_at)`, when OUR READER pulled
 *     the row. This window is NOT an ordering claim and must never be read as one. Its
 *     anchor is late by an unknown amount — the poll interval, plus the queue, plus the
 *     backfill schedule, plus however long the item existed before we started watching
 *     that source — and it can only ever be late, never early. All it can honestly bound
 *     is WHERE IT IS WORTH LOOKING.
 *
 * ★ THE ASYMMETRY IS THE RECORD OF THE DIFFERENCE, AND IT IS STRUCTURAL RATHER THAN A
 * LABEL. A first-sight window REACHES BACKWARDS PAST ITS OWN ANCHOR; a post-anchored one
 * never does. So the two are not the same window with a different name on it — the shape
 * itself says "we do not know when this began, only when we noticed", and any later
 * reader can see it in the numbers without trusting this comment. `windowIsOrdered`
 * below is that difference as a predicate, and window.test.ts asserts it in both
 * directions so the day someone makes the fallback forward-only, a test says what it
 * cost rather than a row quietly saying CREATE.
 *
 * The arithmetic is the derivation and not a preference. With `posted` unknown:
 *
 *     minted ∈ [posted + minLag, posted + maxLag]        the rule we actually believe
 *     posted ∈ [sight − lookback, sight]                 the reader is late, never early
 *     ⟹ minted ∈ [sight + minLag − lookback, sight + maxLag]
 *
 * Note what falls out of that: the FORWARD end is `maxLag` in both cases and is exactly
 * sound, because `posted ≤ sight` makes `posted + maxLag ≤ sight + maxLag`. Only the
 * backward end needs a new number, and it needs one precisely because "how late can our
 * own reader be" is a quantity the resolve window never had to know. It is
 * `DEFAULT_POLICY.resolve.firstSightLookbackMs`, and the sweep behind its value is on the
 * field.
 *
 * ★ WHAT THIS FILE IS NOT ALLOWED TO DO, stated once. `anchorMs` on a first-sight window
 * must never be written to `public.story.earliest_post_at`, never passed to the resolve
 * gates as a post time, and never recorded as a decision's `subject_origin`. Those are
 * ordering positions and this clock cannot hold one. The `anchor` tag exists so that a
 * caller which is about to do any of that has to read the word `first_sight` first.
 */

import { DEFAULT_POLICY } from '@insidor/contracts';
import type { Millis } from '@insidor/contracts';

/**
 * Which clock the window hangs on. A closed two-value vocabulary, never a boolean:
 * `anchoredOnPostTime: false` reads as an absence, and this is not an absence — it is a
 * different measurement with a different meaning, and it wants a name of its own.
 */
export type WindowAnchor = 'earliest_post' | 'first_sight';

export interface CoinWindow {
  readonly anchor: WindowAnchor;
  /** The instant the window is hung on. NOT a post time when `anchor` is `first_sight`. */
  readonly anchorMs: Millis;
  /** Inclusive. Before `anchorMs` exactly when the anchor cannot support an ordering. */
  readonly fromMs: Millis;
  /** Inclusive. */
  readonly toMs: Millis;
}

/**
 * The two instants a story offers, both minimised over its members.
 *
 * `earliestPostMs` is null when NOT ONE member carried a post time — which is a real
 * state in the seed and a common one in the world, because a source may omit the time or
 * be known to lie about it (see the column comment in 0002_items.sql). It is deliberately
 * NOT read from `public.story.earliest_post_at`: that column is NOT NULL only because
 * Postgres' `least()` ignores nulls, so for exactly these stories it already holds a
 * first-seen value wearing a post time's name, with no column anywhere recording which
 * clock it came from.
 *
 * `earliestSightMs` is null only when the story has no members at all. Such a story has no
 * `entitySpan` fingerprints either — spans are read through the same `story_member` rows —
 * so coins.ts links it to nothing regardless of what retrieval returns, and returning no
 * window for it costs nothing.
 */
export interface StoryClocks {
  readonly earliestPostMs: Millis | null;
  readonly earliestSightMs: Millis | null;
}

/**
 * The three bounds, read off the policy rather than typed here.
 *
 * Shaped as an argument for the same reason `CandidateTuning` in coins.ts is: a test that
 * sweeps a bound has to sweep it with a literal, and DEFAULT_POLICY is deeply frozen on
 * purpose so that a policy mutated mid-run cannot make its own hash a lie.
 */
export interface WindowTuning {
  readonly minLagMs: number;
  readonly maxLagMs: number;
  readonly firstSightLookbackMs: number;
}

export const DEFAULT_WINDOW_TUNING: WindowTuning = {
  minLagMs: DEFAULT_POLICY.resolve.minLagMs,
  maxLagMs: DEFAULT_POLICY.resolve.maxLagMs,
  firstSightLookbackMs: DEFAULT_POLICY.resolve.firstSightLookbackMs,
};

/**
 * The window for one story, or null when the story offers no clock at all.
 *
 * The post time WINS whenever there is one, and that ordering of the branches is the
 * whole safety property: a story that has a real anchor is never demoted to the weaker
 * one, so nothing here can widen a window that was already honest.
 */
export function coinWindow(
  clocks: StoryClocks,
  tuning: WindowTuning = DEFAULT_WINDOW_TUNING,
): CoinWindow | null {
  const { earliestPostMs, earliestSightMs } = clocks;

  if (earliestPostMs !== null) {
    return {
      anchor: 'earliest_post',
      anchorMs: earliestPostMs,
      fromMs: earliestPostMs + tuning.minLagMs,
      toMs: earliestPostMs + tuning.maxLagMs,
    };
  }

  if (earliestSightMs === null) return null;

  return {
    anchor: 'first_sight',
    anchorMs: earliestSightMs,
    /* Reaching back past the anchor by the lookback, MINUS nothing: `minLagMs` still
       applies because it is part of the mint rule, and subtracting the lookback from the
       same expression is what keeps both ends derived from one inequality rather than
       from two independent decisions that could drift apart. */
    fromMs: earliestSightMs + tuning.minLagMs - tuning.firstSightLookbackMs,
    toMs: earliestSightMs + tuning.maxLagMs,
  };
}

/**
 * Whether anything retrieved through this window may be read as "minted after the post".
 *
 * True only for an `earliest_post` window, and the implementation asks the NUMBERS rather
 * than the tag — a window that reaches before its own anchor cannot support an ordering
 * whatever it calls itself. That is the check that survives somebody adding a third
 * anchor, or widening the fallback and forgetting what widening means.
 */
export function windowIsOrdered(window: CoinWindow): boolean {
  return window.anchor === 'earliest_post' && window.fromMs >= window.anchorMs;
}

/**
 * How many stories on this frame hung their window on each clock.
 *
 * Exists so the projector can print it. A run that quietly starts anchoring half the
 * board on our own reading schedule is a thing an operator has to be able to see from the
 * line the run prints, not from a query somebody thinks to write later — and this
 * projector CANNOT write it to internal.decisions where it belongs, because it holds the
 * service credential and 0001 grants the service role SELECT on `internal` and nothing
 * more (INSERT there is `insidor_internal`'s alone, verified against the live database:
 * `has_table_privilege('insidor_service','internal.decisions','insert')` is false). The
 * honest home for this is a `verdict='abstain'`, `reason='S1_input_incomplete'`,
 * `subject_origin=null` row written by the stage that runs under that credential. Until
 * then it is printed, and the counting is here rather than in main.ts so the printing has
 * nothing in it that could disagree with the windows actually used.
 */
export function countAnchors(
  windows: Iterable<CoinWindow>,
): Readonly<Record<WindowAnchor, number>> {
  const counts: Record<WindowAnchor, number> = { earliest_post: 0, first_sight: 0 };
  for (const window of windows) counts[window.anchor] += 1;
  return counts;
}
