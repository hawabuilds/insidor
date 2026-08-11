/**
 * RESOLVE — which asset, if any, was minted from this story?
 *
 * The product is not being first to mint; a mint lands within a couple of minutes of
 * the source post and takes days to peak. The product is naming the real one while it
 * is still climbing. So the expensive error is not slowness, it is confidence: one
 * phrase can produce hundreds of assets, and the wrong one presented confidently is
 * the failure that costs a user money.
 *
 * Which is why this stage has three ways to say no and only one to say yes:
 *   - every candidate eliminated by a gate      → drop, with the gate that did it
 *   - nothing cleared the confidence bar        → ABSTAIN, unsure
 *   - the best is not separated from the second → ABSTAIN, unsure
 *
 * An abstain is not a failure state to be tuned away. It renders as a story with no
 * Buy affordance, it is logged with its full feature vector, and those logs are
 * exactly the adjudicated labels that let a venue eventually clear its cold start.
 * The abstain rate going down is only good news if the margin went up.
 *
 * Every number is in Policy. There are no numeric literals in this file.
 */

import type { Decision, StageContext } from '@insidor/contracts/decision.ts';
import type { FeatureSetId, FeatureVector } from '@insidor/contracts/features.ts';
import { candidateId } from '@insidor/contracts/ids.ts';
import type { VenueId } from '@insidor/contracts/ids.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { ReasonCode } from '@insidor/contracts/reasons.ts';
import type { Story } from '@insidor/contracts/story.ts';
import type { Millis } from '@insidor/contracts/vocabulary.ts';

import { decide as makeDecision } from '../decide.ts';
import { MS_PER_MINUTE } from '../math.ts';
import { candidateLagMs, gateDepth, runGates, type ResolveCandidate } from './gates.ts';
import { isConfident, separation } from './margin.ts';
import { candidateScore } from './score.ts';

export const NAME = 'resolve' as const;
export const FEATURE_SET: FeatureSetId = 'candidate.resolve.v1';
export const DECIDER = 'rule:resolve@1';

/** Everything this stage may see. Every read has already happened. */
export interface ResolveInput {
  readonly story: Story;
  /**
   * Retrieved time-first: everything minted inside the story's window, capped at
   * Policy.resolve.maxCandidates and ordered by origin time. Symbol never selects
   * this set — it only scores within it.
   */
  readonly candidates: readonly ResolveCandidate[];
  /**
   * How many adjudicated labels each venue has of its own. Scores are NOT comparable
   * across venues — the collision statistic depends on that venue's symbol density
   * and the time channel on its lag distribution — so a new venue's first month is
   * read-only, enforced here rather than remembered.
   */
  readonly venueLabelCounts: Readonly<Record<string, number>>;
  /** What the quote and read calls cost. Metered by the adapters, passed as data. */
  readonly costUsd: number;
}

interface Scored {
  readonly candidate: ResolveCandidate;
  readonly score: number;
  readonly lagMs: Millis | null;
}

/* ── features ─────────────────────────────────────────────────────────── */

function vector(
  input: ResolveInput,
  survivors: readonly Scored[],
  gated: readonly ReasonCode[],
  venueLabels: number,
): FeatureVector {
  const best = survivors[0] ?? null;
  const second = survivors[1] ?? null;
  const s = best?.candidate.signals ?? null;
  const bestLag = best?.lagMs ?? null;

  return {
    candidateCount: input.candidates.length,
    gatedCount: gated.length,
    survivorCount: survivors.length,

    bestScore: best?.score ?? null,
    secondScore: second?.score ?? null,
    margin: best === null || second === null ? null : best.score - second.score,

    bestLagMin: bestLag === null ? null : bestLag / MS_PER_MINUTE,
    bestSymbol: s?.symbol ?? null,
    bestCollisionIdf: s?.collisionIdf ?? null,
    bestSemantic: s?.semantic ?? null,
    bestImage: s?.image ?? null,
    bestDeclared: s?.declared ?? null,
    bestAllInBps: best?.candidate.quote?.allInBps ?? null,

    venueLabels,
    storyMembers: input.story.memberCount,
    storyDistinctAuthors: input.story.distinctAuthors,
  };
}

/* ── the decision ─────────────────────────────────────────────────────── */

export function resolve(input: ResolveInput, p: Policy, ctx: StageContext): Decision {
  const { story } = input;

  const survivors: Scored[] = [];
  const gated: ReasonCode[] = [];

  for (const candidate of input.candidates) {
    const blocked = runGates(candidate, story, p);
    if (blocked !== null) {
      gated.push(blocked);
      continue;
    }
    const lagMs = candidateLagMs(candidate, story);
    survivors.push({ candidate, score: candidateScore(candidate.signals, lagMs, p), lagMs });
  }

  // Candidate isolation: each score depends only on its own candidate, so this order
  // is reproducible from the stored vectors alone. Ties break on the earlier origin,
  // which is the only tiebreaker that is not an opinion.
  survivors.sort((a, b) => b.score - a.score || (a.lagMs ?? 0) - (b.lagMs ?? 0));

  const best = survivors[0] ?? null;
  const venue: VenueId | null = best?.candidate.venue ?? null;
  const venueLabels = venue === null ? 0 : (input.venueLabelCounts[venue] ?? 0);

  const f = vector(input, survivors, gated, venueLabels);

  const base = {
    stage: NAME,
    subjectKind: best === null ? ('story' as const) : ('candidate' as const),
    subjectId:
      best === null ? story.storyId : candidateId(story.storyId, best.candidate.asset.ref),
    featureAsOf: newestInput(input),
    subjectOrigin: story.earliestPostAt,
    features: f,
    featureSet: FEATURE_SET,
    costUsd: input.costUsd,
  };

  const scorer = p.scorers.resolve;
  const decider = scorer ? scorer.id : DECIDER;

  if (input.candidates.length === 0) {
    return makeDecision(
      { ...base, verdict: 'drop', reason: 'V3_no_candidates', score: null, decider: DECIDER },
      ctx,
    );
  }

  if (best === null) {
    // Everything was eliminated. Report the gate the FURTHEST candidate reached: it
    // is the most informative single reason, and it makes "which gate is eating the
    // traffic" one query rather than a study.
    const furthest = deepestGate(gated);
    return makeDecision(
      {
        ...base,
        verdict: 'drop',
        // An asset that predates the story was adopted by it, not minted from it.
        // That is a different claim about a real thing, not a mismatch.
        reason: furthest === 'G2_predates_post' ? 'V5_adopted' : furthest,
        score: null,
        decider: DECIDER,
      },
      ctx,
    );
  }

  const bestScore = scorer ? scorer.score(f) : best.score;
  const sep = separation(bestScore, survivors[1]?.score ?? null);

  if (venueLabels < p.resolve.minVenueLabels) {
    return makeDecision(
      { ...base, verdict: 'abstain', reason: 'V4_venue_cold_start', score: bestScore, decider },
      ctx,
    );
  }

  if (!isConfident(sep, p)) {
    return makeDecision(
      {
        ...base,
        verdict: 'abstain',
        reason: sep.best < p.resolve.tauHigh ? 'V2_unsure_score' : 'V1_unsure_margin',
        score: bestScore,
        decider,
      },
      ctx,
    );
  }

  return makeDecision(
    { ...base, verdict: 'pass', reason: 'V0_confirmed', score: bestScore, decider },
    ctx,
  );
}

/** The gate reason belonging to whichever candidate survived longest. */
function deepestGate(gated: readonly ReasonCode[]): ReasonCode {
  let deepest: ReasonCode = 'S1_input_incomplete';
  let depth = -1;
  for (const reason of gated) {
    const d = gateDepth(reason);
    if (d > depth) {
      depth = d;
      deepest = reason;
    }
  }
  return deepest;
}

/**
 * The newest datum this decision was allowed to see: the story's last member, or a
 * venue reading if one is fresher. Never the clock.
 */
function newestInput(input: ResolveInput): Millis {
  let newest = input.story.lastMemberAt;
  for (const c of input.candidates) {
    const observedAt = c.market?.observedAt;
    if (observedAt !== undefined && observedAt > newest) newest = observedAt;
  }
  return newest;
}
