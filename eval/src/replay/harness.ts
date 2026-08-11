/**
 * REPLAY — re-run the pure core over the decision log under a candidate policy,
 * and report which verdicts would flip.
 *
 * THIS IS THE PAYOFF OF EVERY OTHER CONSTRAINT IN THE SYSTEM, and it is worth
 * saying why it works, because the properties it depends on look like taste
 * until you try to do this without them:
 *
 *   - The decision log froze `features` at the moment of the decision, before
 *     the outcome existed. So the replay reads the exact numbers the decider
 *     saw. It does not recompute them, and it CANNOT — the raw inputs are gone,
 *     and the world moved underneath them anyway.
 *   - `decide()` is synchronous, so it cannot fetch, cannot query, cannot call a
 *     hosted model. Replaying six months of decisions therefore needs no
 *     network, no API key, and no vendor being up. This package is forbidden
 *     from importing adapters, and that ban is what makes the guarantee real
 *     rather than aspirational.
 *   - Every row carries its `policyHash`, so "what bar was this judged against"
 *     is answerable and a before/after comparison is not comparing two
 *     unknowables.
 *
 * WHAT IS COMPARED. `before` is read from the LOG — it is what actually
 * happened, not a recomputation. `after` is the candidate policy applied to the
 * frozen vector. Recomputing `before` would hide the one class of bug that
 * matters most here: a replay that disagrees with the log about the past.
 */

import type { Decision, StageName, Verdict } from '@insidor/contracts';
import type { FeatureSetId, FeatureVector } from '@insidor/contracts/features.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { ReasonCode } from '@insidor/contracts/reasons.ts';

import type { Lane } from '../lane.ts';
import { laneOf } from '../lane.ts';
import type { DecisionSource } from './source.ts';

/** What a candidate policy would have decided, given the frozen vector. */
export interface Redecision {
  readonly verdict: Verdict;
  readonly reason: ReasonCode;
  readonly score: number | null;
}

/**
 * A pure re-decider. Takes only the frozen feature vector and a policy — no
 * context, no clock, no subject. If a candidate rule needs anything else, it
 * needs a feature, and a feature has to be shipped and left to accrue rows
 * before it can be replayed. That constraint is the point, not a limitation:
 * a rule that reads something the log did not record is a rule that cannot be
 * evaluated against the past, and pretending otherwise is how lookahead returns.
 */
export type Redecider = (f: FeatureVector, p: Policy) => Redecision;

export interface ReplayOptions {
  readonly deciders: Readonly<Partial<Record<StageName, Redecider>>>;
  readonly policy: Policy;
  /** Restrict to these lanes. The report prints what that means for the claim. */
  readonly lanes?: readonly Lane[];
  /**
   * Feature sets the candidate deciders understand. A row written under an older
   * set is SKIPPED AND COUNTED, never scored: an old row is missing the newer
   * keys, the decider reads undefined, and the flip it produces is an artefact
   * of the schema rather than of the policy.
   */
  readonly featureSets?: readonly FeatureSetId[];
}

export type SkipReason = 'no_decider_for_stage' | 'lane_excluded' | 'feature_set_excluded';

export interface ReplayFlip {
  readonly stage: StageName;
  readonly subjectId: string;
  readonly lane: Lane;
  readonly before: Redecision;
  readonly after: Redecision;
  readonly policyHashBefore: string;
  readonly decidedAt: number;
}

export interface ReplayResult {
  readonly seen: number;
  readonly considered: number;
  readonly skipped: Readonly<Record<SkipReason, number>>;
  readonly flips: number;
  /** `'pass→drop'` → count. Every transition, including the unchanged ones. */
  readonly transitions: ReadonlyMap<string, number>;
  /** `'Q5_generic_name'` → count, over rows whose reason CHANGED. */
  readonly newReasons: ReadonlyMap<ReasonCode, number>;
  readonly lanes: readonly Lane[];
  readonly stages: readonly StageName[];
  readonly featureSets: readonly FeatureSetId[];
  readonly window: { readonly fromMs: number; readonly toMs: number } | null;
  /** A bounded sample of flips, for the report. Never the whole log. */
  readonly examples: readonly ReplayFlip[];
}

export interface ReplayLimits {
  /** How many flip examples to retain. The rest are counted only. */
  readonly maxExamples: number;
}

/**
 * ★ THE INVARIANT THIS HARNESS EXISTS TO CHECK, besides the flips themselves:
 * running the CURRENT policy over the log must reproduce the log. If it does
 * not, the replay is not a replay, and every number produced by every candidate
 * policy is meaningless. Call `replay` with the live policy and assert
 * `result.flips === 0` before trusting any candidate run.
 */
export async function replay(
  source: DecisionSource,
  opts: ReplayOptions,
  limits: ReplayLimits,
): Promise<ReplayResult> {
  const lanes = opts.lanes ?? (['exploit', 'epsilon', 'holdout'] as const);
  const skipped: Record<SkipReason, number> = {
    no_decider_for_stage: 0,
    lane_excluded: 0,
    feature_set_excluded: 0,
  };
  const transitions = new Map<string, number>();
  const newReasons = new Map<ReasonCode, number>();
  const examples: ReplayFlip[] = [];
  const stages = new Set<StageName>();
  const featureSets = new Set<FeatureSetId>();

  let seen = 0;
  let considered = 0;
  let flips = 0;
  let fromMs = Number.POSITIVE_INFINITY;
  let toMs = Number.NEGATIVE_INFINITY;

  for await (const d of source) {
    seen++;

    const decider = opts.deciders[d.stage];
    if (decider === undefined) {
      skipped.no_decider_for_stage++;
      continue;
    }

    const lane = laneOf(d);
    if (!lanes.includes(lane)) {
      skipped.lane_excluded++;
      continue;
    }

    if (opts.featureSets !== undefined && !opts.featureSets.includes(d.featureSet)) {
      skipped.feature_set_excluded++;
      continue;
    }

    considered++;
    stages.add(d.stage);
    featureSets.add(d.featureSet);
    if (d.decidedAt < fromMs) fromMs = d.decidedAt;
    if (d.decidedAt > toMs) toMs = d.decidedAt;

    // ★ from the log, not recomputed
    const before: Redecision = { verdict: d.verdict, reason: d.reason, score: d.score };
    const after = decider(d.features, opts.policy);

    const key = `${before.verdict}→${after.verdict}`;
    transitions.set(key, (transitions.get(key) ?? 0) + 1);

    const changed = before.verdict !== after.verdict || before.reason !== after.reason;
    if (changed) {
      flips++;
      newReasons.set(after.reason, (newReasons.get(after.reason) ?? 0) + 1);
      if (examples.length < limits.maxExamples) {
        examples.push({
          stage: d.stage,
          subjectId: d.subjectId,
          lane,
          before,
          after,
          policyHashBefore: d.policyHash,
          decidedAt: d.decidedAt,
        });
      }
    }
  }

  return {
    seen,
    considered,
    skipped,
    flips,
    transitions,
    newReasons,
    lanes: [...lanes],
    stages: [...stages],
    featureSets: [...featureSets],
    window: considered > 0 ? { fromMs, toMs } : null,
    examples,
  };
}
