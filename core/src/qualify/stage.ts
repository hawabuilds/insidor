/**
 * QUALIFY — is there a nameable, coinable thing in this story?
 *
 * HOW THIS FILE STAYS FREE OF I/O, given that it consults a language model: it does
 * not consult one. The service calls the judge adapter, gets a Judgement, and hands
 * it in as `input.judgement` — data, like any other field. This function only reads.
 * If the judge was not called, `judgement` is null and we ABSTAIN with a named reason
 * rather than deciding blind.
 *
 * Consequences worth stating, because they are the point:
 *   - Replaying this stage over the decision log needs no network and no key.
 *   - Swapping the judge changes nothing here.
 *   - The deterministic caps below CANNOT be overridden by the model, because they
 *     run after it and their inputs are ours.
 *
 * ORDERING, which was a measured bug: this runs AFTER promotion, never before. In the
 * build this replaces the title was written forty-five lines before the code that
 * decided whether the story was eligible to exist, which cost about twelve judge
 * calls per surviving story. The gate below makes the ordering a decision rather than
 * a convention.
 *
 * Every number is in Policy. There are no numeric literals in this file.
 */

import type { Decision, StageContext } from '@insidor/contracts/decision.ts';
import type { FeatureSetId, FeatureVector } from '@insidor/contracts/features.ts';
import type { JudgeAbsence, Judgement } from '@insidor/contracts/judgement.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { ReasonCode } from '@insidor/contracts/reasons.ts';
import type { Story, StoryMember } from '@insidor/contracts/story.ts';

import { decide as makeDecision } from '../decide.ts';
import { MS_PER_MINUTE, clamp01 } from '../math.ts';
import { isGenericTicker } from './generic-tickers.ts';
import { nameabilityCap, subjectSpecificity } from './nameability.ts';
import { distinctAuthors, distinctSources, freeJoinShare } from './rules.ts';

/**
 * The stage's identity, copied onto every row it writes. See `admit/stage.ts` for the
 * full argument: `DECIDER` moves when the rule changes, `FEATURE_SET` when the vector's
 * shape does.
 *
 * ★ IT IS THE FALLBACK, NOT THE ANSWER. `decide()` below writes `scorer.id` when a
 * learned scorer is configured and this constant only when none is — so `DECIDER`
 * spells what judged the row on the day no model existed, and the log distinguishes
 * the two eras without anybody having to remember when the switch happened. The gated
 * rows keep `DECIDER` regardless, and the invariant that makes that legible is shared
 * with RESOLVE and RANK: wherever `score` is null, no scorer decided.
 *
 * ★ AND IT STAYS `rule:` EVEN THOUGH A LANGUAGE MODEL IS CONSULTED HERE. The judge's
 * answer arrives as an INPUT and the deterministic caps run after it and may only lower
 * it, so what decided is still this rule; `Judgement.judgeId` is where the model's
 * identity is recorded. Spelling this `judge:...` would credit the model for refusals it
 * did not make and hide the caps from anyone reading the log.
 */
export const NAME = 'qualify' as const;
export const FEATURE_SET: FeatureSetId = 'story.qualify.v2';
export const DECIDER = 'rule:qualify@3';

const PRESENT = 1;
const ABSENT = 0;

/** Everything this stage may see. Assembled by services from the store. */
export interface QualifyInput {
  readonly story: Story;
  readonly members: readonly StoryMember[];
  /** null when the judge was not called or failed. NOT an empty judgement. */
  readonly judgement: Judgement | null;
  /**
   * Why `judgement` is null, when it is. Ignored when a judgement is present. Each
   * absence abstains with its own reason, so a paused budget, an outage and a dry run
   * stay three different rows (see `JudgeAbsence`).
   */
  readonly unjudged: JudgeAbsence;
  /** What the judge call cost us. Metered by the adapter, passed as data. */
  readonly judgeCostUsd: number;
}

/* ── features ─────────────────────────────────────────────────────────── */

export function extract(input: QualifyInput, ctx: StageContext): FeatureVector {
  const { story, members, judgement } = input;

  const authors = distinctAuthors(members);
  const sources = distinctSources(members);
  const proposed = judgement?.proposedName ?? null;
  const spans = judgement?.subjectSpans ?? [];

  return {
    memberCount: members.length,
    distinctAuthors: authors,
    distinctSources: sources,
    isCrossSource: sources > 1 ? PRESENT : ABSENT,
    freeJoinShare: freeJoinShare(members),
    isPromoted: story.state === 'promoted' ? PRESENT : ABSENT,
    // Promotion is the clock this stage's age is measured from, because that is when
    // the story became something anything downstream was allowed to look at.
    ageMin: (ctx.now - (story.promotedAt ?? story.createdAt)) / MS_PER_MINUTE,

    // judge channel — ABSENT is distinct from NEGATIVE, and stays distinct
    judgePresent: judgement ? PRESENT : ABSENT,
    judgeCoinable: judgement ? (judgement.coinable ? PRESENT : ABSENT) : null,
    judgeConfidence: judgement?.confidence ?? null,
    judgeAlternates: judgement ? judgement.alternateNames.length : null,
    // v2: what the judge was shown, which decides the confidence bar. ABSENT when unjudged.
    judgeSawVideoFrame: judgement ? (judgement.lookedAt === 'videoFrame' ? PRESENT : ABSENT) : null,

    // our channel — computed from our own data, never from the judge's prose
    nameProposed: proposed ? PRESENT : ABSENT,
    nameIsGeneric: proposed ? (isGenericTicker(proposed) ? PRESENT : ABSENT) : null,
    nameSpecificity: proposed ? subjectSpecificity(proposed, spans) : null,
    nameLen: proposed ? proposed.length : null,
  };
}

/* ── hard gates: rules the judge cannot argue with ────────────────────── */

/**
 * The gates that need no judge: is the story promoted, and is it broad enough.
 *
 * ★ THEY RUN BEFORE THE JUDGE IS EVEN CONSULTED, and the runner asks this same function
 * whether a story is worth a paid call (`worthJudging`). A story that will be dropped for
 * having one author is never sent, and is dropped as `Q2` rather than abstaining as
 * unjudged forever. One function, so the runner's "worth asking" and this stage's gates
 * cannot drift apart.
 */
function cheapGate(f: FeatureVector, p: Policy): ReasonCode | null {
  if (f.isPromoted === ABSENT) return 'S0_not_applicable';
  if ((f.distinctAuthors ?? 0) < p.qualify.minDistinctAuthors) return 'Q2_single_author';
  if ((f.memberCount ?? 0) < p.qualify.minMembers) return 'Q3_too_thin';
  return null;
}

const ABSENCE_REASON: Readonly<Record<JudgeAbsence, ReasonCode>> = {
  not_asked: 'Q1_unjudged',
  unavailable: 'Q11_judge_unavailable',
  budget: 'Q12_judge_budget_paused',
  dry_run: 'Q13_judge_dry_run',
};

/** Every reason that means "we have no answer", as opposed to "the answer was no". */
const ABSTAINS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['S0_not_applicable', ...Object.values(ABSENCE_REASON)]);

export function gate(f: FeatureVector, p: Policy, unjudged: JudgeAbsence = 'not_asked'): ReasonCode | null {
  const cheap = cheapGate(f, p);
  if (cheap !== null) return cheap;
  if (f.judgePresent === ABSENT) return ABSENCE_REASON[unjudged];
  if (f.nameProposed === ABSENT) return 'Q4_unnameable';
  if (f.nameIsGeneric === PRESENT) return 'Q5_generic_name';
  if ((f.nameLen ?? 0) < p.qualify.minNameLen) return 'Q6_name_too_short';
  if ((f.nameSpecificity ?? 0) < p.qualify.minSpecificity) return 'Q7_name_unspecific';
  if (f.judgeCoinable === PRESENT && (f.judgeConfidence ?? 0) < confidenceBar(f, p)) return 'Q10_judge_unsure';
  return null;
}

/**
 * Whether this story is worth a judge call at all: true only when every gate that needs
 * no judge passes. The runner calls this before spending anything.
 */
export function worthJudging(input: Pick<QualifyInput, 'story' | 'members'>, p: Policy, ctx: StageContext): boolean {
  return cheapGate(extract({ ...input, judgement: null, unjudged: 'not_asked', judgeCostUsd: 0 }, ctx), p) === null;
}

/**
 * The bar a "coinable" answer's confidence must clear, chosen by what the judge looked at.
 *
 * Last of the gates on purpose: it reads the judge's self-report, so it runs only after
 * every rule whose inputs are ours, and only on a YES — a confident NO is left to Q9. A
 * missing judgement never gets here; Q1 abstains first.
 */
function confidenceBar(f: FeatureVector, p: Policy): number {
  return f.judgeSawVideoFrame === PRESENT ? p.qualify.minJudgeConfidence.videoFrame : p.qualify.minJudgeConfidence.text;
}

/* ── score: only reached when every gate passed ───────────────────────── */

function score(f: FeatureVector, p: Policy): number {
  const w = p.qualify.weights;
  const raw =
    w.judgeConfidence * (f.judgeConfidence ?? 0) +
    w.specificity * (f.nameSpecificity ?? 0) +
    w.crossSource * (f.isCrossSource ?? 0) +
    w.authorBreadth * clamp01((f.distinctAuthors ?? 0) / p.qualify.authorBreadthFull);
  // The cap runs AFTER the model's contribution and can only LOWER the result.
  return Math.min(clamp01(raw), nameabilityCap(f, p));
}

/* ── the decision ─────────────────────────────────────────────────────── */

export function qualify(input: QualifyInput, p: Policy, ctx: StageContext): Decision {
  const f = extract(input, ctx);

  const base = {
    stage: NAME,
    subjectKind: 'story' as const,
    subjectId: input.story.storyId,
    featureAsOf: input.story.lastMemberAt,
    subjectOrigin: input.story.earliestPostAt,
    features: f,
    featureSet: FEATURE_SET,
    costUsd: input.judgeCostUsd,
  };

  // A model, if one is loaded, arrives as a pure sync closure on the Policy.
  // core NEVER imports ml/. This one line is "a rule today, a model tomorrow".
  const scorer = p.scorers.qualify;

  const blocked = gate(f, p, input.unjudged);
  if (blocked !== null) {
    // ABSTAIN, not drop, when we have no answer. "We could not ask" and "the answer
    // was no" are different populations, and merging them poisons every recall
    // number downstream.
    const neverAsked = ABSTAINS.has(blocked);
    return makeDecision(
      {
        ...base,
        verdict: neverAsked ? 'abstain' : 'drop',
        reason: blocked,
        score: null,
        decider: DECIDER,
      },
      ctx,
    );
  }

  const s = scorer ? scorer.score(f) : score(f, p);
  const decider = scorer ? scorer.id : DECIDER;

  if (s < p.qualify.passScore) {
    return makeDecision(
      { ...base, verdict: 'drop', reason: 'Q8_score_below_bar', score: s, decider },
      ctx,
    );
  }

  // The judge saying "not coinable" is respected only HERE, after our gates.
  // Half to two-thirds of stories landing on Q9 is the correct outcome, not a tuning
  // target: a design that optimises this number upward reintroduces the wrong-coin bug.
  if (f.judgeCoinable === ABSENT) {
    return makeDecision(
      { ...base, verdict: 'drop', reason: 'Q9_judged_not_coinable', score: s, decider },
      ctx,
    );
  }

  return makeDecision({ ...base, verdict: 'pass', reason: 'Q0_coinable', score: s, decider }, ctx);
}
