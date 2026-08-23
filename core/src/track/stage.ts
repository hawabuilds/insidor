/**
 * TRACK — when do we look at this item again?
 *
 * This is a spending decision wearing a scheduling costume: every read costs money
 * at a vendor, and the shape of the read schedule is what determines whether the
 * kinetics have anything to work with. The rules it implements are written out in
 * schedule.ts and shed.ts, and the lane assignment it shares with ADMIT is in
 * holdout.ts.
 *
 * WHAT MUST NOT CHANGE: an item's history length may not depend on its early
 * performance. That is the outcome, and conditioning the record on it poisons every
 * model trained on the record afterwards.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ EVERY WAY THIS STAGE STOPS READING AN ITEM IS A ROW, NOT A SKIP. That is the one
 * property the whole file is arranged around, and it is why there are seven T-codes
 * for what looks like a yes/no question. "We did not read it" is four different facts:
 *
 *   T6_not_due          the schedule says later                        hold
 *   T2_budget_shed      we chose not to, because reads ran out         hold
 *   T4_unreachable      we tried and the source returned nothing       hold
 *   T3_terminal         the lifecycle ended; we stop on purpose        drop
 *
 * ★ T2 IS A HOLD AND NEVER A DROP, by the identical argument admit/stage.ts makes for
 * A9_budget_exhausted: an item we could not afford and an item we decided against are
 * different populations, and merging them makes every later recall number over this
 * stage a lie. An unaffordable item is still eligible; the budget is a fact about us.
 *
 * ★ T4 IS A HOLD FOR A DIFFERENT REASON: an outage is not a claim. A source returning
 * nothing tells us about the source. Dropping on it would end an item's history
 * because a vendor had a bad minute, and the item that vanishes is disproportionately
 * likely to be one on a source that is struggling — which correlates the gaps in the
 * record with exactly the conditions that make the record interesting.
 *
 * ★ WHERE `shed()` FITS, since it is not called from here and that looks like an
 * omission. `shed()` is the AGGREGATE form: it takes the whole interval's demand and
 * answers which tiers the budget covers. `track()` is per-item and takes the answer as
 * `readsAvailable`. The split is forced — a per-item function cannot see the interval's
 * demand — and it is the same shape as RANK's, where the score is per-subject and the
 * board transition is not. T2 here is the per-item RECORD of the decision shed() made.
 *
 * Every number is in Policy. There are no numeric literals in this file beyond the
 * 0/1 encoding of a boolean feature.
 */

import type { Decision, StageContext } from '@insidor/contracts/decision.ts';
import type { FeatureSetId, FeatureVector } from '@insidor/contracts/features.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { ReasonCode } from '@insidor/contracts/reasons.ts';
import type { Item, Millis, Observation } from '@insidor/contracts/vocabulary.ts';

import { decide as makeDecision } from '../decide.ts';
import { isTerminal, type LifecycleReading } from '../kinetics/lifecycle.ts';
import { MS_PER_HOUR, MS_PER_MINUTE } from '../math.ts';
import { nextRead, type Schedule } from './schedule.ts';

/**
 * The stage's identity, copied onto every row it writes. See `admit/stage.ts` for the
 * full argument; the short form is that `DECIDER` must move when the RULE changes and
 * `FEATURE_SET` must move when the vector's SHAPE changes, because nothing else in the
 * row distinguishes either.
 *
 * It bites hardest here. TRACK writes far more rows than any other stage — one per
 * re-read decision per item — so an unbumped version pollutes the largest table in the
 * system, and the pollution is invisible until somebody fits on it.
 */
export const NAME = 'track' as const;
export const FEATURE_SET: FeatureSetId = 'item.track.v1';
export const DECIDER = 'rule:track@1';

const PRESENT = 1;
const ABSENT = 0;

/**
 * Everything this stage may see. Every read has already happened; nothing is fetched.
 *
 * ★ THREE OF THESE FIELDS ARE CARRIED IN RATHER THAN DERIVED, AND EACH FOR THE SAME
 * REASON: they are STATE ACROSS READINGS, and this stage sees one reading. `lifecycle`,
 * `censoredReadStreak` and `isHeldBack` all describe the item's history or its lane, and
 * a stage that recomputed any of them from the current pass would be substituting an
 * instant for a series. The individual consequences differ — flapping on the terminal
 * edge, a demotion that forgets it was already demoting, a holdout item that stops being
 * a holdout — but the shape of the mistake is identical, and none of the three fails
 * loudly.
 */
export interface TrackInput {
  readonly item: Item;
  /** The readings so far, newest last. Rates carry their own censoring. */
  readonly observations: readonly Observation[];
  readonly lastReadAt: Millis;
  readonly tier: number;
  /** The item's last decided score, which selects the tier. null before the first. */
  readonly lastScore: number | null;
  /** Consecutive readings that produced no usable rate. Drives lifecycle demotion. */
  readonly censoredReadStreak: number;
  /**
   * The item's committed lifecycle state, or null before the first reading.
   *
   * ★ AN INPUT AND NEVER RECOMPUTED HERE. `T3_terminal` is the one verdict that ends
   * an item's history, and the state that produces it is built by a hysteresis machine
   * over a series of readings (kinetics/lifecycle.ts) — not from anything visible in
   * one pass. Recomputing it here from the current reading would be the flapping the
   * hysteresis exists to prevent, applied to the single most expensive edge there is.
   */
  readonly lifecycle: LifecycleReading | null;
  /** From the lane assignment made at admission. Never recomputed here. */
  readonly isHeldBack: boolean;
  /** Reads left in this interval's budget, as a number. Nothing is queried here. */
  readonly readsAvailable: number;
  readonly costUsd: number;
}

/* ── the schedule this item is on ─────────────────────────────────────── */

interface Plan {
  readonly schedule: Schedule;
  readonly demoted: boolean;
}

/**
 * The tier and the due time, with the censored-streak demotion applied on top.
 *
 * ★ THE DEMOTION REPLACES THE SCORE'S TIER RATHER THAN COMPOSING WITH IT, and that is
 * the whole reason it is applied here instead of inside nextRead.
 *
 * The score is stale by construction in exactly this case: `censoredReadStreak` counts
 * consecutive readings that produced NO USABLE RATE, so the last several reads
 * contributed nothing to the number `lastScore` holds. A run of censored reads is
 * newer evidence than the score those reads failed to move. Letting the two compose
 * would mean a stale 0.95 cancels a live demotion and the item keeps its tier — which
 * is the expensive direction, because the tier it keeps is the one that costs money.
 *
 * ★ AND IT IS STILL EXACTLY ONE TIER. The demotion is measured from the item's CURRENT
 * tier, not from the score's, so it cannot stack into a two-tier fall — that would be
 * the "history length tracks early performance" failure arriving through the censoring
 * path instead of the scoring one.
 */
function plan(input: TrackInput, p: Policy): Plan {
  const scheduled = nextRead(
    input.lastReadAt,
    input.tier,
    input.lastScore,
    input.isHeldBack,
    p,
  );

  // The holdout is never demoted. It is on the full grid for its whole life, and a
  // censored streak is a fact about the source's counters, not a reason to make the
  // one unbiased sample in the system read less often than the biased one.
  const demoted = !input.isHeldBack && input.censoredReadStreak >= p.track.flatReadsToDemote;
  if (!demoted) return { schedule: scheduled, demoted: false };

  const probationTier = p.track.tierMinutes.length - 1;
  const tier = Math.min(input.tier + 1, probationTier);
  const minutes = p.track.tierMinutes[tier] ?? 0;
  return {
    schedule: { tier, dueAt: input.lastReadAt + minutes * MS_PER_MINUTE },
    demoted: true,
  };
}

/* ── features ─────────────────────────────────────────────────────────── */

/**
 * ★ IT TAKES A POLICY, AND THE STUB'S SIGNATURE DID NOT — the same departure, for the
 * same reason, as detect/stage.ts's extract. Every bar this stage is judged against is
 * a policy constant: `maxTrackedHours`, `flatReadsToDemote`, the grid itself. A vector
 * that records `trackedHours` without recording the bound it was compared against is a
 * vector `gate()` cannot replay, which would make the whole re-read grid untestable
 * against history. group/stage.ts:281 makes the argument at length and it applies here
 * word for word.
 */
export function extract(input: TrackInput, p: Policy, ctx: StageContext): FeatureVector {
  const { schedule, demoted } = plan(input, p);
  const grid = p.track.tierMinutes;
  const probationTier = grid.length - 1;

  // "Has anything ever been read" — the two clocks are distinct: firstSeenAt is when
  // the item entered our world and lastReadAt is when we last asked the source about
  // it, so lastReadAt moving past firstSeenAt is exactly one completed read.
  const hasBeenRead = input.lastReadAt > input.item.firstSeenAt;

  return {
    trackedHours: (ctx.now - input.item.firstSeenAt) / MS_PER_HOUR,
    maxTrackedHours: p.track.maxTrackedHours,
    minutesSinceLastRead: (ctx.now - input.lastReadAt) / MS_PER_MINUTE,

    isHeldBack: input.isHeldBack ? PRESENT : ABSENT,
    hasBeenRead: hasBeenRead ? PRESENT : ABSENT,
    observationCount: input.observations.length,

    currentTier: input.tier,
    scheduledTier: schedule.tier,
    scheduledIntervalMin: grid[schedule.tier] ?? null,
    probationTier,
    // Negative when overdue, which is the useful sign: a large negative number here on
    // many items at once is the queue falling behind, and it is visible in the log
    // without anybody having instrumented the queue.
    dueInMin: (schedule.dueAt - ctx.now) / MS_PER_MINUTE,

    // null before the first score, never 0. A zero would be a claim that the item
    // scored badly, and "not scored yet" is not a claim about anything — the same rule
    // that makes nextRead hold the current tier rather than demoting on an absence.
    lastScore: input.lastScore,

    censoredReadStreak: input.censoredReadStreak,
    flatReadsToDemote: p.track.flatReadsToDemote,
    demoted: demoted ? PRESENT : ABSENT,

    lifecycleTerminal:
      input.lifecycle === null ? null : isTerminal(input.lifecycle.state) ? PRESENT : ABSENT,
    lifecycleAgreeing: input.lifecycle?.agreeing ?? null,

    readsAvailable: input.readsAvailable,
  };
}

/* ── the ladder, as a pure function of the logged vector ──────────────── */

/**
 * Every TRACK threshold, applied to nothing but what the decision row carries.
 *
 * Returns null on the three PASSING outcomes — T0, T1 and T5 — exactly as
 * group/stage.ts's gate does, because a gate answers "was anything blocking" and
 * which flavour of yes it was is the stage's business. `passReasonFor` below is the
 * other half, and the tests assert the pair agrees with `track()` on every fixture.
 */
export function gate(f: FeatureVector, p: Policy): ReasonCode | null {
  const heldBack = f.isHeldBack === PRESENT;

  /* ★ Terminal is checked first and the holdout is exempt from it. "Stop re-reading
     after this, UNLESS the item is in the holdout" is the policy field's own wording,
     and it is the strongest form of the invariant: the one lane whose history length
     is guaranteed not to depend on anything at all is the lane that is never stopped,
     not even by the clock. */
  if (!heldBack) {
    if (f.lifecycleTerminal === PRESENT) return 'T3_terminal';
    if ((f.trackedHours ?? 0) > p.track.maxTrackedHours) return 'T3_terminal';
  }

  if ((f.dueInMin ?? 0) > 0) return 'T6_not_due';

  // We have read it and it has never produced a reading. That is the source telling us
  // nothing, which is a hold; see the header on why it is not a drop.
  if (f.hasBeenRead === PRESENT && (f.observationCount ?? 0) === 0) return 'T4_unreachable';

  // ★ The budget is consulted AFTER the holdout is let through, and that ordering is
  // the whole of "never consults the budget". Exploration is recoverable by re-enabling
  // it; a hole in the unbiased record is not, so the holdout outranks the money.
  if (heldBack) return null;

  if ((f.readsAvailable ?? 0) < 1) return 'T2_budget_shed';

  return null;
}

/** Which flavour of pass. Only meaningful when `gate` returned null. */
export function passReasonFor(f: FeatureVector): ReasonCode {
  if (f.isHeldBack === PRESENT) return 'T5_holdout_full_grid';
  if (f.demoted === PRESENT) return 'T1_tier_demoted';
  return 'T0_scheduled';
}

/** T3 stops tracking. The other three blocked outcomes are all "not now". */
export function verdictFor(reason: ReasonCode): 'drop' | 'hold' {
  return reason === 'T3_terminal' ? 'drop' : 'hold';
}

/* ── the decision ─────────────────────────────────────────────────────── */

export function track(input: TrackInput, p: Policy, ctx: StageContext): Decision {
  const f = extract(input, p, ctx);
  const { item } = input;

  const base = {
    stage: NAME,
    subjectKind: 'item' as const,
    subjectId: item.itemId,
    featureAsOf: newestInput(input),
    subjectOrigin: item.postedAt,
    features: f,
    featureSet: FEATURE_SET,
    costUsd: input.costUsd,
  };

  // A model, if one is loaded, arrives as a pure sync closure on the Policy. core
  // NEVER imports ml/. It scores; it does not decide whether a read is due, because
  // when a read is due is arithmetic and a model that could move it would be a model
  // that could make an item's history length a function of its predicted outcome.
  const scorer = p.scorers.track;
  const decider = scorer ? scorer.id : DECIDER;
  const score = scorer ? scorer.score(f) : null;

  const blocked = gate(f, p);
  if (blocked !== null) {
    return makeDecision(
      { ...base, verdict: verdictFor(blocked), reason: blocked, score: null, decider: DECIDER },
      ctx,
    );
  }

  return makeDecision(
    { ...base, verdict: 'pass', reason: passReasonFor(f), score, decider },
    ctx,
  );
}

/**
 * The newest input datum this decision was allowed to see. Not the clock: the clock is
 * when we decided, and conflating the two is how lookahead comes back.
 */
function newestInput(input: TrackInput): Millis {
  let newest = input.item.firstSeenAt;
  if (input.lastReadAt > newest) newest = input.lastReadAt;
  for (const o of input.observations) {
    if (o.capturedAt > newest) newest = o.capturedAt;
  }
  return newest;
}
