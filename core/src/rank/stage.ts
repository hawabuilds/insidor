/**
 * RANK — what goes on the board, in what order.
 *
 * RANK IS THE LAST STAGE TO BECOME A MODEL, NOT THE FIRST. It needs board
 * impressions and clicks, which do not exist yet and will not for months. A small
 * team that gets this ordering wrong spends a quarter training the model that
 * matters least.
 *
 * Before any of it is built, run the plain age-decayed control from a public news
 * ranker against the existing snapshot series, scored on early detection. If the
 * control wins, "the old formula with hotter constants" was the right answer and one
 * cheap experiment saved a month. That is a real possibility, not a formality.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ THE SPLIT THIS FILE COMMITS TO, WRITTEN DOWN BECAUSE IT GETS SILENTLY REVERSED.
 *
 * `rank()` is PER SUBJECT. `commitBoard()` is PER BOARD. A slot is a position in an
 * ordering over everything, so one subject's input cannot produce one, and the doc's
 * "heat, then the hysteresis rules, then the slot" describes two functions rather
 * than one.
 *
 *   rank()        scores a subject from its own inputs, tests it against the ONE
 *                 incumbent it is contending with, and writes the row. It never sees
 *                 another candidate.
 *   commitBoard() takes the tick's scores together and produces the committed order.
 *
 * The split is forced by heat.ts's candidate isolation, which is a product
 * requirement and not a tuning choice: "every term depends only on the item being
 * scored… the board does not reshuffle because an unrelated story arrived, and any
 * row's position is reproducible from its own stored feature vector". If the SCORE
 * ever sees another candidate, a replay of a past board becomes impossible, because
 * reproducing one row would mean reproducing every row that existed beside it. So the
 * score is isolated and the TRANSITION is not — a transition obviously must compare
 * rows, and it is pure and reproducible from the stored scores, which is a different
 * and weaker guarantee that is enough for it.
 *
 * ★ WHAT THE ROW RECORDS, AND WHY IT IS NOT THE SCORE. The vector logs the four raw
 * inputs to `heat()` and NOT the number that came out. `heat` is
 * `(rate·√burst·quality)^alpha / ((age+t0)/t0)^gamma`, and all three exponents are
 * policy. A row that froze the output could never be replayed against a different
 * alpha — which is the single most likely thing anybody will ever want to replay this
 * stage against. Freezing the inputs and recomputing in `gate()` means a curve change
 * is a query. The cost is one multiplication per replayed row.
 *
 * ★ AND A STALE INPUT IS AN ABSTAIN, NOT A DROP. `R5_features_stale` means the newest
 * thing we know about this subject is older than a board tick may rely on. That is a
 * statement about our own reader, not about the subject, and scoring it as "below the
 * cut" would convert our outage into a claim that the world went quiet.
 *
 * Every number is in Policy. There are no numeric literals in this file beyond the
 * 0/1 encoding of a boolean feature.
 */

import type { Decision, StageContext } from '@insidor/contracts/decision.ts';
import type { FeatureSetId, FeatureVector } from '@insidor/contracts/features.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { ReasonCode } from '@insidor/contracts/reasons.ts';
import type { Millis } from '@insidor/contracts/vocabulary.ts';

import { decide as makeDecision } from '../decide.ts';
import { MS_PER_SECOND } from '../math.ts';
import { isExploreDraw } from '../track/holdout.ts';
import { heat, type HeatInputs } from './heat.ts';

export const NAME = 'rank' as const;
export const FEATURE_SET: FeatureSetId = 'subject.rank.v1';
export const DECIDER = 'rule:rank@1';

const PRESENT = 1;
const ABSENT = 0;

export interface RankInput {
  readonly subjectId: string;
  readonly subjectKind: 'story' | 'candidate';
  readonly heat: HeatInputs;
  /**
   * ★ WHETHER `heat.burst` WAS MEASURED, or is the neutral stand-in a caller has to
   * pass because `HeatInputs.burst` is a plain number.
   *
   * `detect/burst.ts` returns `number | null` and its null is load-bearing: "we could
   * not measure whether this is bending" is not "it is flat". The heat primitive takes
   * a number, so that absence has nowhere to travel on the way in — and if it is not
   * carried beside it, the vector logs a 1 that reads for ever as a measured flat, and
   * the new-entrant hatch fires on a ratio nobody measured. This field is the absence,
   * kept as its own column so the row states its own reason.
   */
  readonly burstMeasured: boolean;
  /**
   * The newest input datum behind `heat`. Drives R5_features_stale, and is what
   * `decide()` checks against the clock — a vector built from something newer than
   * the decision is the lookahead the store refuses as a CHECK constraint.
   */
  readonly featureAsOf: Millis;
  /**
   * When the subject itself began — a story's earliest post. `horizonS` is computed
   * from it, and horizonS is the column that answers "how early were we", which is
   * the product's whole claim and is the one thing RANK is in a position to record.
   * Null rather than the clock when no member carried a post time.
   */
  readonly subjectOrigin: Millis | null;
  /** The committed board this subject is being scored against, for the dwell rules. */
  readonly incumbentScore: number | null;
  readonly incumbentSince: Millis | null;
  readonly slot: number | null;
  readonly costUsd: number;
}

/* ── features ─────────────────────────────────────────────────────────── */

/**
 * The rank vector.
 *
 * It takes no Policy, and unlike DETECT and GROUP that is genuinely correct here
 * rather than an omission: every comparison this stage makes is (a quantity, a bar),
 * the quantities are all policy-free, and `gate()` reads the bars off the Policy it
 * is handed. Nothing is judged against an implicit constant, so there is no bar to
 * log. The one thing that WOULD have needed a policy — the heat score — is
 * deliberately not in the vector; its four inputs are, and they are raw.
 */
export function extract(input: RankInput, ctx: StageContext): FeatureVector {
  const h = input.heat;

  return {
    /* ── the four heat inputs, raw, so a curve change replays ──────────── */
    rateLcbNorm: h.rateLcbNorm,
    quality: h.quality,
    ageMin: h.ageMin,
    /** What was fed to the primitive. `gate()` recomputes heat from exactly this. */
    heatBurst: h.burst,
    /** What was MEASURED. Null when nothing was, which the hatch must not read as 0. */
    burst: input.burstMeasured ? h.burst : null,
    burstMeasured: input.burstMeasured ? PRESENT : ABSENT,

    /* ── how fresh the evidence is ─────────────────────────────────────── */
    featureAgeS: (ctx.now - input.featureAsOf) / MS_PER_SECOND,

    /* ── the one row this subject is contending with ───────────────────── */
    onBoard: input.slot === null ? ABSENT : PRESENT,
    slot: input.slot,
    /** Null when no row holds the place — a free slot, not a score of zero. */
    incumbentScore: input.incumbentScore,
    /** How long the incumbent has held it. Null when there is no incumbent. */
    incumbentDwellS:
      input.incumbentSince === null ? null : (ctx.now - input.incumbentSince) / MS_PER_SECOND,

    /* ── which lane the subject came from ──────────────────────────────── */
    subjectIsStory: input.subjectKind === 'story' ? PRESENT : ABSENT,
  };
}

/* ── the ladder, as a pure function of the logged vector ──────────────── */

/**
 * Every RANK threshold, applied to nothing but what the decision row carries.
 *
 * WHY IT EXISTS SEPARATELY FROM `rank()`: eval/src/replay/core-stages.ts replays a
 * stage through `gate(features, policy)` and nothing else, because the log holds the
 * vector and not the stage input — the board a subject was contending against six
 * months ago cannot be reconstructed. Without this function `swapEdge`, `minDwellS`,
 * `maxFeatureAgeS` and the three heat exponents are untestable against history, which
 * would make every one of them a number nobody can ever move safely.
 *
 * `rank()` calls this rather than repeating the ladder, so the two cannot disagree.
 * The test asserts it anyway, because "cannot disagree" is a property of today's
 * code and the assertion is a property of the repository.
 */
export function gate(f: FeatureVector, p: Policy): ReasonCode | null {
  // First, because everything below it is a claim about a subject and this is the one
  // test that says we are not entitled to make one.
  if ((f.featureAgeS ?? 0) > p.rank.maxFeatureAgeS) return 'R5_features_stale';

  // Already committed. Whether it LEAVES is the board's question — it depends on
  // three consecutive ticks below and on who is waiting, neither of which is visible
  // from one subject. A per-subject stage that tried to answer it would be answering
  // it from a fraction of the evidence.
  if (f.onBoard === PRESENT) return null;

  const incumbent = f.incumbentScore ?? null;
  // Nothing holds the place. A free slot is not a contest.
  if (incumbent === null) return null;

  const score = heatOf(f, p);

  if (score <= incumbent) return 'R1_below_cut';
  // Ahead, but not ahead ENOUGH. This is the rule that stops two near-identical
  // scores trading places every twenty seconds under a reader's cursor.
  if (score < incumbent + p.rank.swapEdge) return 'R3_hysteresis_hold';
  if (!isNewEntrant(f, p) && (f.incumbentDwellS ?? 0) < p.rank.minDwellS) return 'R2_dwell_hold';

  return null;
}

/**
 * The heat score, rebuilt from the logged inputs.
 *
 * The three `?? 0` are the SCORE's rule and not the vector's, and the distinction is
 * the same one resolve/score.ts draws: a vector keeps an absence as an absence, and a
 * score has to be a number. Scoring an unmeasured channel as zero — rather than
 * renormalising it away — is what stops a subject with one measurable input looking
 * as convincing as one with four. `heat()` already returns exactly 0 when the product
 * is non-positive, so "no evidence" lands on zero heat rather than on a small
 * positive number, which is the property its own test pins.
 */
function heatOf(f: FeatureVector, p: Policy): number {
  return heat(
    {
      rateLcbNorm: f.rateLcbNorm ?? 0,
      burst: f.heatBurst ?? 0,
      quality: f.quality ?? 0,
      ageMin: f.ageMin ?? 0,
    },
    p,
  );
}

/**
 * The escape hatch, tested against the MEASURED burst.
 *
 * `f.burst` is null when nothing was measured and `?? 0` never clears the bar, which
 * is the correct direction: the hatch exists to let a measured explosion past the
 * dwell rule, not to let an unmeasured one past it. Reading `heatBurst` here instead
 * would open the hatch on whatever stand-in the caller happened to pass.
 */
function isNewEntrant(f: FeatureVector, p: Policy): boolean {
  return (f.burst ?? 0) >= p.rank.newEntrantBurst;
}

/** R5 is "we were not entitled to say"; R1 is "we looked and said no". */
function verdictFor(reason: ReasonCode): 'drop' | 'hold' | 'abstain' {
  if (reason === 'R5_features_stale') return 'abstain';
  if (reason === 'R1_below_cut') return 'drop';
  return 'hold';
}

/* ── the decision ─────────────────────────────────────────────────────── */

export function rank(input: RankInput, p: Policy, ctx: StageContext): Decision {
  const f = extract(input, ctx);

  const base = {
    stage: NAME,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    featureAsOf: input.featureAsOf,
    subjectOrigin: input.subjectOrigin,
    features: f,
    featureSet: FEATURE_SET,
    costUsd: input.costUsd,
  };

  // A model, if one is loaded, arrives as a pure sync closure on the Policy. core
  // NEVER imports ml/. This is the "a rule today, a model tomorrow" slot — and RANK
  // is the last stage that should fill it, because it needs board impressions and
  // clicks that will not exist for months.
  const scorer = p.scorers.rank;
  const decider = scorer ? scorer.id : DECIDER;
  const score = scorer ? scorer.score(f) : heatOf(f, p);

  const blocked = gate(f, p);

  if (blocked === 'R5_features_stale') {
    // No score at all: we did not judge this subject, we declined to.
    return makeDecision(
      { ...base, verdict: 'abstain', reason: blocked, score: null, decider: DECIDER },
      ctx,
    );
  }

  if (blocked === 'R1_below_cut') {
    // ★ The exploration slots, and the reason they have their own budget. A
    // deterministic ranker has propensity 1 for the rows it showed and 0 for every
    // row it did not, which makes "would this have performed on the board" a question
    // with no defined answer — for ever, because no later cleverness recovers a
    // randomisation that never happened. Drawing from below the cut with the
    // propensity recorded is what buys the answer, and it costs feed quality, which
    // is why `exploreSlotShare` is a written number rather than a principle.
    if (isExploreDraw(ctx.seed, p.rank.exploreSlotShare, p.explore.holdoutSalt)) {
      return makeDecision(
        {
          ...base,
          verdict: 'pass',
          reason: 'R6_explore_slot',
          score,
          decider,
          exploreArm: 'epsilon',
          propensity: p.rank.exploreSlotShare,
        },
        ctx,
      );
    }
    return makeDecision(
      { ...base, verdict: 'drop', reason: blocked, score, decider },
      ctx,
    );
  }

  if (blocked !== null) {
    return makeDecision(
      { ...base, verdict: verdictFor(blocked), reason: blocked, score, decider },
      ctx,
    );
  }

  // Through the ladder. The hatch is recorded as its own reason rather than folded
  // into R0, because "entered early because it was genuinely exploding" and "entered
  // because it beat the incumbent fairly" are different populations, and the hatch is
  // the one that has to justify its own churn later.
  const entered: ReasonCode =
    f.onBoard === ABSENT && f.incumbentScore !== null && isNewEntrant(f, p)
      ? 'R4_new_entrant'
      : 'R0_ranked';

  return makeDecision({ ...base, verdict: 'pass', reason: entered, score, decider }, ctx);
}
