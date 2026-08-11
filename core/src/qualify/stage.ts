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
import type { Judgement } from '@insidor/contracts/judgement.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { ReasonCode } from '@insidor/contracts/reasons.ts';
import type { Story, StoryMember } from '@insidor/contracts/story.ts';

import { decide as makeDecision } from '../decide.ts';
import { MS_PER_MINUTE, clamp01 } from '../math.ts';
import { isGenericTicker } from './generic-tickers.ts';
import { nameabilityCap, subjectSpecificity } from './nameability.ts';
import { distinctAuthors, distinctSources, freeJoinShare } from './rules.ts';

export const NAME = 'qualify' as const;
export const FEATURE_SET: FeatureSetId = 'story.qualify.v1';
export const DECIDER = 'rule:qualify@1';

const PRESENT = 1;
const ABSENT = 0;

/** Everything this stage may see. Assembled by services from the store. */
export interface QualifyInput {
  readonly story: Story;
  readonly members: readonly StoryMember[];
  /** null when the judge was not called or failed. NOT an empty judgement. */
  readonly judgement: Judgement | null;
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

    // our channel — computed from our own data, never from the judge's prose
    nameProposed: proposed ? PRESENT : ABSENT,
    nameIsGeneric: proposed ? (isGenericTicker(proposed) ? PRESENT : ABSENT) : null,
    nameSpecificity: proposed ? subjectSpecificity(proposed, spans) : null,
    nameLen: proposed ? proposed.length : null,
  };
}

/* ── hard gates: rules the judge cannot argue with ────────────────────── */

export function gate(f: FeatureVector, p: Policy): ReasonCode | null {
  if (f.isPromoted === ABSENT) return 'S0_not_applicable';
  if (f.judgePresent === ABSENT) return 'Q1_unjudged';
  if ((f.distinctAuthors ?? 0) < p.qualify.minDistinctAuthors) return 'Q2_single_author';
  if ((f.memberCount ?? 0) < p.qualify.minMembers) return 'Q3_too_thin';
  if (f.nameProposed === ABSENT) return 'Q4_unnameable';
  if (f.nameIsGeneric === PRESENT) return 'Q5_generic_name';
  if ((f.nameLen ?? 0) < p.qualify.minNameLen) return 'Q6_name_too_short';
  if ((f.nameSpecificity ?? 0) < p.qualify.minSpecificity) return 'Q7_name_unspecific';
  return null;
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

  const blocked = gate(f, p);
  if (blocked !== null) {
    // ABSTAIN, not drop, when we simply never asked. The two are different
    // populations, and merging them poisons every recall number downstream.
    const neverAsked = blocked === 'Q1_unjudged' || blocked === 'S0_not_applicable';
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
