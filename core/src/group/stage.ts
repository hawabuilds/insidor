/**
 * GROUP — which story is this item part of?
 *
 * The highest-leverage stage in the system and the worst one in the build this
 * replaces, where the similarity function was a term-frequency map with no term
 * weighting and no learned representation. The result: ninety-one percent of
 * populated stories held exactly one post by one author. A product whose premise is
 * that people make their own versions of things could not see a second version.
 *
 * The design is two tiers and the free one does most of the work — see carriers.ts.
 * The subject of this stage's decision is a PAIR, which is why Decision.subjectKind
 * has a 'pair' member: the thing being judged is (item, story), and logging it that
 * way is what makes the match model trainable on hand-labelled pairs later.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ THIS STAGE HAS THREE ANSWERS, NOT TWO, and the third is the one that has to be
 * defended every time somebody looks at the abstain rate.
 *
 *   join            — one candidate is over the bar and clear of the runner-up
 *   drop            — we looked at the block and said no          (M3, M5)
 *   abstain         — we could not tell, or there was nothing to tell from (M4, M6)
 *
 * `abstain` is not `drop`. An M4 pair is one where our own ordering is inside the
 * noise; joining it to the higher of two indistinguishable stories would not be more
 * accurate, it would be equally accurate and no longer able to say so. The
 * adjudicated answer arrives later as data — this stage never fabricates one.
 *
 * ★ AND IT DEGRADES RATHER THAN STOPPING. Everything above happens on the free
 * tiers. `similarity` arriving empty means the embed port was skipped or is down,
 * and the only thing that changes is that the paid tier contributes nothing and the
 * vector records three separate facts about why. It does not throw, and it does not
 * score a missing similarity as zero — a zero is a claim about how alike two things
 * are, and an outage is not a claim about anything.
 *
 * Every number is in Policy. There are no numeric literals in this file.
 */

import type { Decision, StageContext } from '@insidor/contracts/decision.ts';
import type { FeatureSetId, FeatureVector } from '@insidor/contracts/features.ts';
import { pairId } from '@insidor/contracts/ids.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { ReasonCode } from '@insidor/contracts/reasons.ts';
import type { Story } from '@insidor/contracts/story.ts';
import type { Item, Millis } from '@insidor/contracts/vocabulary.ts';

import { decide as makeDecision } from '../decide.ts';
import { MS_PER_MINUTE } from '../math.ts';
import type { CarrierCorpus } from './carriers.ts';
import {
  adjudicate,
  carrierChannel,
  matchScore,
  readRepresentation,
  representationConsulted,
  timeGapMs,
  timeProximity,
  type LineageLink,
  type MatchOutcome,
  type MatchResult,
  type PairContext,
} from './match.ts';

export const NAME = 'group' as const;
/**
 * v2 adds `representationObserved` — the similarity the embed port actually returned,
 * as opposed to the one a calibrated bar made interpretable. v1 recorded only the
 * latter, and under the shipped `similarityBars: {}` the latter is always null, so a v1
 * row can carry a paid similarity of 0.97 and log nothing. The name is bumped rather
 * than the key quietly repurposed because a feature set that changes shape under a name
 * it already used poisons every training row that shares its label window.
 */
export const FEATURE_SET: FeatureSetId = 'pair.group.v2';
export const DECIDER = 'rule:group@1';

const PRESENT = 1;
const ABSENT = 0;

export interface GroupInput {
  readonly item: Item;
  /** The candidate block: open stories sharing at least one carrier or time bucket. */
  readonly candidates: readonly Story[];
  /**
   * Representation similarity per (story, space), supplied by the embed port. Absent
   * entries mean the paid tier was skipped or unavailable, which must DEGRADE the
   * match rather than block it.
   */
  readonly similarity: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /**
   * The item's lineage pointer, already resolved to the story that holds the item it
   * points at. Null when the item has no pointer, or when it has one and the item it
   * names is not in any story yet.
   *
   * WHY IT IS AN INPUT: `Item.reproductionOf` names an ITEM and `Story` carries no
   * member list, so turning "points at item X" into "points into story S" is a store
   * lookup. A stage that could do a lookup could do a fetch. Same shape as QUALIFY's
   * judgement — the resolution happens outside, the answer arrives as a field, and
   * the replay needs neither.
   */
  readonly lineage: LineageLink | null;
  /**
   * Persistence statistics for the carriers in play — a store query, so it arrives as
   * data. Empty is the honest day-one state and is handled by carriers.ts, which
   * weights a carrier the corpus has never seen at full strength rather than at zero.
   * A zero default would mean nothing joins until fourteen days of history exist.
   */
  readonly corpus: CarrierCorpus;
  readonly costUsd: number;
}

/* ── scoring the block ────────────────────────────────────────────────── */

function contextOf(input: GroupInput): PairContext {
  return { lineage: input.lineage, corpus: input.corpus };
}

function scoreBlock(input: GroupInput, p: Policy): readonly MatchResult[] {
  const context = contextOf(input);
  return input.candidates.map((story) =>
    matchScore(input.item, story, input.similarity[story.storyId] ?? {}, p, context),
  );
}

function bestOf(outcome: MatchOutcome): MatchResult | null {
  return outcome.kind === 'empty' ? null : outcome.best;
}

/**
 * ★ EVERY OUTCOME THAT HAS A RUNNER-UP REPORTS IT, including `rejected`.
 *
 * This used to return null for `rejected`, on the reasoning that a dropped pair has no
 * second place worth naming. It has one, and `gate()` needs it: the vector is replayed
 * against policies other than the one that produced it, and a block of two
 * indistinguishable candidates dropped under today's `matchBar` is an AMBIGUOUS block
 * under a lower one. With `scoreMargin` logged as null, `gate` skipped the
 * `M4_ambiguous_match` test and returned null — a join — for a pair whose two
 * candidates had scored identically. The band was un-ignorable inside `adjudicate` and
 * quietly optional on replay, which is the same hole one layer down.
 */
function runnerUpOf(outcome: MatchOutcome): MatchResult | null {
  return outcome.kind === 'empty' ? null : outcome.runnerUp;
}

/* ── features ─────────────────────────────────────────────────────────── */

/**
 * The pair vector: the seven match channels on the best candidate, plus the shape of
 * the block it was chosen from.
 *
 * ABSENCE IS NEVER A ZERO HERE, and the three representation keys are the reason the
 * rule is worth restating. `representationConsulted` says whether we even reached the
 * paid tier, `representationPresent` says whether it gave us a number we could
 * compare against a calibrated bar, and `representationSimilarity` is that number.
 * An outage, a short circuit and a genuine dissimilarity are three different rows,
 * and a single defaulted `0.0` would make all three identical for ever.
 */
function vector(
  input: GroupInput,
  results: readonly MatchResult[],
  outcome: MatchOutcome,
  p: Policy,
  ctx: StageContext,
): FeatureVector {
  const { item } = input;
  const best = bestOf(outcome);
  const runnerUp = runnerUpOf(outcome);

  const blockShape = {
    candidateCount: input.candidates.length,
    scoredCount: results.length,
    bestScore: best?.score ?? null,
    secondScore: runnerUp?.score ?? null,
    scoreMargin: best === null || runnerUp === null ? null : best.score - runnerUp.score,
  };

  if (best === null) {
    // Nothing to compare against. Every pair channel is null rather than zero: there
    // was no pair, so there is no channel that measured anything.
    return {
      ...blockShape,
      imageCarrierOffered: null,
      imageCarrierShared: null,
      imageCarrierDistance: null,
      textCarrierOffered: null,
      textCarrierShared: null,
      textCarrierDistance: null,
      exactCarrierOffered: null,
      exactCarrierShared: null,
      sharedCarrierCount: null,
      carrierWeight: null,
      sharedCarrierWeight: null,
      lineageOffered: item.rebroadcastOf === null && item.reproductionOf === null ? ABSENT : PRESENT,
      lineagePresent: null,
      representationConsulted: null,
      representationPresent: null,
      representationSimilarity: null,
      representationObserved: null,
      sourceAgreement: null,
      timeProximity: null,
      timeGapMin: null,
      storyMembers: null,
      storyDistinctAuthors: null,
      storyDistinctSources: null,
      storyAgeMin: null,
      atMemberCap: null,
    };
  }

  const story = best.story;
  const channel = carrierChannel(item, story, p, input.corpus);
  const image = channel.byKind.imageHash;
  const text = channel.byKind.textShingle;
  const format = channel.byKind.formatId;
  const entity = channel.byKind.entitySpan;

  const representation = readRepresentation(input.similarity[story.storyId] ?? {}, p);
  const consulted = representationConsulted(item, story, p, contextOf(input));

  const hasPointer = item.rebroadcastOf !== null || item.reproductionOf !== null;
  const gapMs = timeGapMs(item, story);

  return {
    ...blockShape,

    // The two distance-based carrier tiers. `offered` says whether the item carried a
    // fingerprint of the kind at all — no adapter can compute an image hash today, so
    // an item with none has said nothing about images, and a defaulted zero would
    // teach a model that every such item is image-dissimilar to everything.
    imageCarrierOffered: image.offered ? PRESENT : ABSENT,
    imageCarrierShared: image.offered ? (image.shared ? PRESENT : ABSENT) : null,
    imageCarrierDistance: image.distance,
    textCarrierOffered: text.offered ? PRESENT : ABSENT,
    textCarrierShared: text.offered ? (text.shared ? PRESENT : ABSENT) : null,
    textCarrierDistance: text.distance,

    // The two exact-match kinds, which have no metric and therefore no distance.
    exactCarrierOffered: format.offered || entity.offered ? PRESENT : ABSENT,
    exactCarrierShared:
      format.offered || entity.offered ? (format.shared || entity.shared ? PRESENT : ABSENT) : null,

    sharedCarrierCount: channel.sharedCount,
    /** The weight of the carrier the join would REST on. Drives M5; see gate(). */
    carrierWeight:
      best.evidence !== null && best.evidence.kind === 'carrier' ? best.evidence.weight : null,
    sharedCarrierWeight: channel.best?.weight ?? null,

    lineageOffered: hasPointer ? PRESENT : ABSENT,
    // Null when the item has no pointer: "this source publishes no lineage" is not
    // "this item's lineage points somewhere else".
    lineagePresent: hasPointer
      ? input.lineage !== null && input.lineage.story === story.storyId
        ? PRESENT
        : ABSENT
      : null,

    representationConsulted: consulted ? PRESENT : ABSENT,
    representationPresent: representation.comparable ? PRESENT : ABSENT,
    representationSimilarity: representation.similarity,
    /* ★ The fourth representation key, and the one that makes the other three
       actionable. `representationSimilarity` is the number a calibrated bar made
       interpretable; this is the number the port RETURNED. Under the shipped
       `similarityBars: {}` they differ on every row: the first is always null and the
       second holds whatever came back. Without it a bar can never be fit — the data a
       bar is fit from is only recorded once the bar exists — and an outage is
       indistinguishable from a healthy read in an uncalibrated space, since both are
       `present: 0, similarity: null`. Here they are `null` and a number. */
    representationObserved: representation.observed,

    sourceAgreement: story.distinctSources > 1 ? PRESENT : ABSENT,
    timeProximity: timeProximity(item, story, p),
    timeGapMin: gapMs === null ? null : gapMs / MS_PER_MINUTE,

    storyMembers: story.memberCount,
    storyDistinctAuthors: story.distinctAuthors,
    storyDistinctSources: story.distinctSources,
    storyAgeMin: (ctx.now - story.earliestPostAt) / MS_PER_MINUTE,
    atMemberCap: story.memberCount >= p.group.maxMembersPerInterval ? PRESENT : ABSENT,
  };
}

/**
 * The vector on its own, for callers that want the features without the decision.
 *
 * ★ IT TAKES A POLICY, and the sibling stages do not. That is not an inconsistency to
 * be tidied away: a pair's features ARE its bars. Whether a carrier is "shared" is
 * `imageHashDistance <= imageHashMaxDistance`, and whether a similarity exists at all
 * is whether its space has a calibrated bar. A vector computed against implicit bars
 * is a vector nobody can audit later, which is the precise failure this whole package
 * is a response to.
 */
export function extract(input: GroupInput, p: Policy, ctx: StageContext): FeatureVector {
  const results = scoreBlock(input, p);
  return vector(input, results, adjudicate(results, p), p, ctx);
}

/* ── the ladder, as a pure function of the logged vector ──────────────── */

/**
 * Every GROUP threshold, applied to nothing but what the decision row carries.
 *
 * WHY IT EXISTS SEPARATELY FROM `group()`: eval/src/replay/core-stages.ts replays a
 * stage through `gate(features, policy)` and nothing else, because the log holds the
 * vector and not the stage input — there is no way to reconstruct a candidate block
 * from six months ago. Without this function a GROUP threshold change is untestable
 * against history, which would make `matchBar` a number nobody can ever move safely.
 *
 * The order is the same as `adjudicate`'s and has to stay that way; the tests assert
 * the two agree on every fixture rather than trusting that they do.
 */
export function gate(f: FeatureVector, p: Policy): ReasonCode | null {
  if ((f.candidateCount ?? 0) === 0) return 'M6_no_candidate_block';

  const best = f.bestScore ?? null;
  if (best === null) return 'M6_no_candidate_block';

  if (best < p.group.matchBar) {
    const weight = f.carrierWeight ?? null;
    return weight !== null && weight <= p.group.minCarrierWeight
      ? 'M5_generic_carrier'
      : 'M3_below_match_bar';
  }

  const margin = f.scoreMargin ?? null;
  if (margin !== null && margin < p.group.adjudicationBand) return 'M4_ambiguous_match';

  if (f.atMemberCap === PRESENT) return 'M9_member_cap';

  return null;
}

/** M4 and M6 are "we did not decide"; M3 and M5 are "we looked and said no". */
function verdictFor(reason: ReasonCode): 'drop' | 'hold' | 'abstain' {
  if (reason === 'M4_ambiguous_match' || reason === 'M6_no_candidate_block') return 'abstain';
  if (reason === 'M9_member_cap') return 'hold';
  return 'drop';
}

/* ── the decision ─────────────────────────────────────────────────────── */

export function group(input: GroupInput, p: Policy, ctx: StageContext): Decision {
  const { item } = input;

  const results = scoreBlock(input, p);
  const outcome = adjudicate(results, p);
  const best = bestOf(outcome);

  const f = vector(input, results, outcome, p, ctx);

  const base = {
    stage: NAME,
    // 'pair' whenever there is something to pair with. With an empty block the
    // subject genuinely is the item: there is no second half to name.
    subjectKind: best === null ? ('item' as const) : ('pair' as const),
    subjectId: best === null ? item.itemId : pairId(item.itemId, best.story.storyId),
    featureAsOf: newestInput(input),
    // When the thing itself began. The story's earliest post when we are judging a
    // pair — a story that starts accreting today may have begun last Tuesday, and
    // horizonS is meaningless if it is measured from the wrong end. The item's own
    // post time when we are seeding, and null rather than the clock when it has none.
    subjectOrigin: best === null ? item.postedAt : best.story.earliestPostAt,
    features: f,
    featureSet: FEATURE_SET,
    costUsd: input.costUsd,
  };

  /*
   * A model, if one is loaded, arrives as a pure sync closure on the Policy. core
   * NEVER imports ml/. This is the "a rule today, a model tomorrow" slot.
   *
   * WHAT IT MAY AND MAY NOT DO, decided here once: it rescores the best pair and the
   * match bar is applied to its number instead of the rule's, so it can veto a join.
   * It does NOT reorder the block — a model that reorders candidates has to be fit on
   * pair rows, and pair rows are the thing this stage is currently producing — and it
   * cannot manufacture a join, because a member row records a reproducible fact about
   * two items and a score is not one.
   */
  const scorer = p.scorers.group;
  const decider = scorer ? scorer.id : DECIDER;
  const score = best === null ? null : scorer ? scorer.score(f) : best.score;

  if (outcome.kind === 'empty') {
    // Nothing to compare against. The caller seeds a new candidate story from this
    // item, whose first member carries `{kind:'seed'}` evidence — there was nothing
    // to match against, and saying so is not the same as failing to match.
    return makeDecision(
      { ...base, verdict: 'abstain', reason: 'M6_no_candidate_block', score, decider: DECIDER },
      ctx,
    );
  }

  if (outcome.kind === 'rejected') {
    const reason: ReasonCode =
      outcome.why === 'generic_carrier' ? 'M5_generic_carrier' : 'M3_below_match_bar';
    return makeDecision({ ...base, verdict: 'drop', reason, score, decider }, ctx);
  }

  if (outcome.kind === 'ambiguous') {
    return makeDecision(
      { ...base, verdict: 'abstain', reason: 'M4_ambiguous_match', score, decider },
      ctx,
    );
  }

  // A loaded model gets its veto here, after the rule has already found the evidence.
  if (score !== null && score < p.group.matchBar) {
    return makeDecision(
      { ...base, verdict: 'drop', reason: 'M3_below_match_bar', score, decider },
      ctx,
    );
  }

  if (outcome.best.story.memberCount >= p.group.maxMembersPerInterval) {
    // HOLD, not drop. The item belongs here and the story is full for this interval;
    // dropping it would throw away a correct join because of a rate limit.
    return makeDecision({ ...base, verdict: 'hold', reason: 'M9_member_cap', score, decider }, ctx);
  }

  return makeDecision(
    { ...base, verdict: 'pass', reason: joinReason(outcome.best.evidence.kind), score, decider },
    ctx,
  );
}

/** Which free tier settled it, as the reason code that names the tier. */
function joinReason(kind: 'seed' | 'carrier' | 'lineage' | 'representation' | 'adjudicated'): ReasonCode {
  if (kind === 'lineage') return 'M1_lineage_join';
  if (kind === 'representation') return 'M2_semantic_join';
  return 'M0_carrier_join';
}

/**
 * The newest datum this decision was allowed to see: when we first saw the item, or a
 * candidate's last member if one is fresher. Never the clock — `decide()` supplies
 * that from ctx, and a featureAsOf taken from a fresher read than the features is the
 * lookahead the store rejects as a CHECK constraint.
 */
function newestInput(input: GroupInput): Millis {
  let newest = input.item.firstSeenAt;
  for (const story of input.candidates) {
    if (story.lastMemberAt > newest) newest = story.lastMemberAt;
  }
  return newest;
}
