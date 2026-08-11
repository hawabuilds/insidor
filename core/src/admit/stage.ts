/**
 * ADMIT — is this item worth spending money to track?
 *
 * This is the only stage that decides to spend, so it is the one place a bad rule
 * costs real dollars per day rather than a wrong row. Three things about its shape
 * are deliberate and are repairs of specific, measured failures:
 *
 * 1. NOTHING HERE GATES ON AN ABSOLUTE COUNTER. Not a reach floor, not an approval
 *    floor. `reach` means autoplay on one source and impressions on another, and on
 *    a third it does not exist at all — so a floor on it is a rule that says "only
 *    admit items from sources shaped like the one we built this for". The build this
 *    replaces hardcoded a view floor, and a source with no public view count would
 *    have been undetectable to it forever. Every term below is a rate, a ratio to
 *    the item's own basis, or a fact about our own corpus.
 *
 * 2. THE BAR IS A QUANTILE, NOT A NUMBER. `admissionBar` arrives as data — the score
 *    at Policy.admit.quantile of the last full day of scored arrivals, recomputed
 *    nightly so admissions land on the tracking budget. A typed score floor drifts
 *    out of calibration the moment volume moves, and cannot be compared across
 *    sources at all.
 *
 * 3. THE HOLDOUT IS CHECKED BEFORE ANY GATE. A held-back arrival is admitted whatever
 *    the gates think, because the entire value of the holdout is measuring what the
 *    gates get wrong, and a holdout filtered by the gates measures nothing.
 *
 * Every number is in Policy. There are no numeric literals in this file beyond the
 * unit conversion and the 0/1 encoding of a boolean feature.
 */

import type { StageContext, Decision } from '@insidor/contracts/decision.ts';
import type { FeatureSetId, FeatureVector } from '@insidor/contracts/features.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { ReasonCode } from '@insidor/contracts/reasons.ts';
import type { Author, Item, Millis } from '@insidor/contracts/vocabulary.ts';

import { decide as makeDecision } from '../decide.ts';
import { MS_PER_MINUTE, clamp01, safeRatio } from '../math.ts';
import { isExploreDraw, isHoldout } from '../track/holdout.ts';
import { engagementBait, threadContinuation } from './bait.ts';

export const NAME = 'admit' as const;
export const FEATURE_SET: FeatureSetId = 'item.admit.v1';
export const DECIDER = 'rule:admit@1';

const PRESENT = 1;
const ABSENT = 0;

/** Everything this stage may see. Assembled by services; nothing is fetched here. */
export interface AdmitInput {
  readonly item: Item;
  /** Our own standing for the account. null when we have never seen it before. */
  readonly author: Author | null;
  /**
   * How fast this item's carriers are spreading across the corpus, relative to their
   * own trailing rate. Computed by the carrier index and handed in, because it is the
   * one strong signal available at ZERO engagement — which is where lead time is made.
   */
  readonly carrierAcceleration: number | null;
  /** The score at today's admission quantile. Recomputed nightly, never typed here. */
  readonly admissionBar: number;
  /** We have already admitted this item under a different source id. */
  readonly alreadyAdmitted: boolean;
  /** The account is on the suppression roster. A roster fact, not a text judgement. */
  readonly authorSuppressed: boolean;
  /** The tracking budget for this interval is spent. */
  readonly budgetExhausted: boolean;
  /** What the discovery call that produced this item cost. Metered by the adapter. */
  readonly costUsd: number;
}

/* ── features ─────────────────────────────────────────────────────────── */

export function extract(input: AdmitInput, ctx: StageContext): FeatureVector {
  const { item } = input;

  // postedAt is null when the source omits it or is known to lie. Falling back to
  // first sight is honest — it is when the item entered OUR world — and the feature
  // below records which clock was used, so a model can learn to distrust one of them.
  const origin = item.postedAt ?? item.firstSeenAt;

  const reach = item.counters.reach?.value ?? null;
  const reproduction = item.counters.reproduction?.value ?? null;

  return {
    ageMin: (ctx.now - origin) / MS_PER_MINUTE,
    originIsPostTime: item.postedAt === null ? ABSENT : PRESENT,
    textLen: item.text.trim().length,
    hasMedia: item.media.length > 0 ? PRESENT : ABSENT,
    langKnown: item.lang === null ? ABSENT : PRESENT,

    isRebroadcast: item.rebroadcastOf === null ? ABSENT : PRESENT,
    isReproduction: item.reproductionOf === null ? ABSENT : PRESENT,

    /**
     * A LEVEL, not a rate: reproductions per unit of reach, available from a single
     * snapshot. null — never zero — when either counter is absent, because a source
     * that cannot count reproductions must not read as a source where nobody
     * reproduced anything. On those sources the same evidence arrives through
     * carrierAcceleration, which is why that term carries the second-largest weight.
     */
    reproductionLevel:
      reproduction === null || reach === null ? null : safeRatio(reproduction, reach),
    carrierAcceleration: input.carrierAcceleration,

    authorRosterTier: input.author?.rosterTier ?? null,
    authorKnown: input.author === null ? ABSENT : PRESENT,
    authorSuppressed: input.authorSuppressed ? PRESENT : ABSENT,

    namedSpanPresent: item.fingerprints.some((f) => f.kind === 'entitySpan') ? PRESENT : ABSENT,
    carrierCount: item.fingerprints.length,
    formatCount: item.formatIds.length,

    engagementBait: engagementBait(item.text),
    threadContinuation: threadContinuation(item.text),

    alreadyAdmitted: input.alreadyAdmitted ? PRESENT : ABSENT,
    admissionBar: input.admissionBar,
  };
}

/* ── hard gates ───────────────────────────────────────────────────────── */

export function gate(f: FeatureVector, p: Policy): ReasonCode | null {
  if (f.isRebroadcast === PRESENT) return 'A1_rebroadcast_not_original';
  if (f.textLen === ABSENT && f.hasMedia === ABSENT) return 'A2_empty';
  if ((f.ageMin ?? 0) > p.admit.maxAgeMin) return 'A3_too_old';
  if (f.alreadyAdmitted === PRESENT) return 'A8_duplicate_item';
  if (f.authorSuppressed === PRESENT) return 'A5_author_suppressed';
  return null;
}

/* ── score ────────────────────────────────────────────────────────────── */

/**
 * A linear score over seven terms. The two penalty weights are negative in Policy,
 * which is why they are added here rather than subtracted — the sign of a term is a
 * product judgement and belongs in the policy object with the magnitude.
 *
 * Raw feature values are clamped HERE and not in extract(), because the frozen
 * vector must record what was actually observed. A feature squashed on its way into
 * the log is a feature a future model can never learn the tail of.
 */
function score(f: FeatureVector, p: Policy): number {
  const w = p.admit.weights;
  return clamp01(
    w.authorRosterTier * clamp01(f.authorRosterTier ?? 0) +
      w.carrierAcceleration * clamp01(f.carrierAcceleration ?? 0) +
      w.hasMedia * (f.hasMedia ?? 0) +
      w.reproductionLevel * clamp01(f.reproductionLevel ?? 0) +
      w.namedSpanPresent * (f.namedSpanPresent ?? 0) +
      w.engagementBait * (f.engagementBait ?? 0) +
      w.threadContinuation * (f.threadContinuation ?? 0),
  );
}

/* ── the decision ─────────────────────────────────────────────────────── */

export function admit(input: AdmitInput, p: Policy, ctx: StageContext): Decision {
  const f = extract(input, ctx);
  const { item } = input;

  const base = {
    stage: NAME,
    subjectKind: 'item' as const,
    subjectId: item.itemId,
    featureAsOf: newestInput(item),
    subjectOrigin: item.postedAt,
    features: f,
    featureSet: FEATURE_SET,
    costUsd: input.costUsd,
  };

  // ★ BEFORE the gates, on purpose. The holdout exists to measure what the gates
  // miss, and it cannot do that if the gates run first. It also survives budget
  // pressure: exploration is recoverable by re-enabling it, a hole in the holdout
  // record is not.
  if (isHoldout(ctx.seed, p.explore.holdoutRate, p.explore.holdoutSalt)) {
    return makeDecision(
      {
        ...base,
        verdict: 'pass',
        reason: 'A10_holdout_admitted',
        score: null,
        decider: DECIDER,
        exploreArm: 'holdout',
        propensity: p.explore.holdoutRate,
      },
      ctx,
    );
  }

  const blocked = gate(f, p);
  if (blocked !== null) {
    return makeDecision(
      { ...base, verdict: 'drop', reason: blocked, score: null, decider: DECIDER },
      ctx,
    );
  }

  // Eligible, and we cannot pay. HOLD, not drop: the two are different populations
  // and merging them makes every later recall number over this stage a lie.
  if (input.budgetExhausted) {
    return makeDecision(
      { ...base, verdict: 'hold', reason: 'A9_budget_exhausted', score: null, decider: DECIDER },
      ctx,
    );
  }

  // A model, when one is loaded, arrives as a pure sync closure on the Policy. core
  // never imports ml/. This one line is "a rule today, a model tomorrow".
  const scorer = p.scorers.admit;
  const s = scorer ? scorer.score(f) : score(f, p);
  const decider = scorer ? scorer.id : DECIDER;

  if (s < input.admissionBar) {
    // Uniform over the eligible-but-below-cut pool, with the propensity recorded, so
    // estimates near the boundary are unbiased. A deterministic policy has propensity
    // 1 for what it did and 0 for everything else, which makes counterfactuals
    // undefined — no later cleverness recovers that.
    if (isExploreDraw(ctx.seed, p.explore.epsilon, p.explore.holdoutSalt)) {
      return makeDecision(
        {
          ...base,
          verdict: 'pass',
          reason: 'A11_explore_admitted',
          score: s,
          decider,
          exploreArm: 'epsilon',
          propensity: p.explore.epsilon,
        },
        ctx,
      );
    }
    return makeDecision(
      {
        ...base,
        verdict: 'drop',
        reason: 'A4_score_below_bar',
        score: s,
        decider,
        // Routine drops are downsampled beyond the full-fidelity window; the rate is
        // recorded so training can reweight by its inverse. A downsample you forgot
        // to write down is a biased training set that looks like a clean one.
        logSampleRate: p.explore.dropLogSampleRate,
      },
      ctx,
    );
  }

  return makeDecision(
    { ...base, verdict: 'pass', reason: 'A0_admitted', score: s, decider },
    ctx,
  );
}

/**
 * The newest input datum this decision was allowed to see. Not the clock: the clock
 * is when we decided, and conflating the two is how lookahead comes back.
 */
function newestInput(item: Item): Millis {
  let newest = item.firstSeenAt;
  for (const counter of Object.values(item.counters)) {
    if (counter !== undefined && counter.observedAt > newest) newest = counter.observedAt;
  }
  return newest;
}
