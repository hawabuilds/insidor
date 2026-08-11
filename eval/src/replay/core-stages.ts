/**
 * Wiring core's stages into re-deciders.
 *
 * WHY THE GATE AND NOT `decide()`: `decide(input, policy, ctx)` takes the stage's
 * full input — the story, its members, the judgement — and the decision log does
 * not carry those. It carries the FEATURE VECTOR, deliberately, because the
 * vector is the only thing that was true at the moment of the decision and stayed
 * true. `gate(features, policy)` is a pure function of exactly what the log holds,
 * so it is the part that replays, and it is also where every threshold lives.
 * A threshold change is what anyone actually wants to replay.
 *
 * The scoring path replays too, but only when the caller hands in the scorer —
 * see `scoredRedecider`. A model's contribution cannot be reconstructed from the
 * log alone, since the log records the score rather than the function.
 *
 * NOTE ON COUPLING: this module reads whatever `@insidor/core`'s narrow barrel
 * exports and checks the shape at RUNTIME rather than assuming it. core's public
 * surface is eight names and is allowed to change; a replay harness that stops
 * compiling because a stage was renamed is a harness that gets deleted.
 */

import type { StageName, Verdict } from '@insidor/contracts';
import type { FeatureVector, FeatureSetId, Scorer } from '@insidor/contracts/features.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { ReasonCode } from '@insidor/contracts/reasons.ts';

import * as core from '@insidor/core';
import type { Redecider, Redecision } from './harness.ts';

export const STAGE_NAMES = ['admit', 'track', 'detect', 'group', 'qualify', 'resolve', 'rank'] as const;

/** The part of contracts' `Stage` interface a replay needs. */
export interface GatedStage {
  readonly name: StageName;
  readonly featureSet: FeatureSetId;
  gate(f: FeatureVector, p: Policy): ReasonCode | null;
}

function isGatedStage(v: unknown): v is GatedStage {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['name'] === 'string' &&
    (STAGE_NAMES as readonly string[]).includes(o['name']) &&
    typeof o['featureSet'] === 'string' &&
    typeof o['gate'] === 'function'
  );
}

/**
 * Every stage core exposes that can be replayed, keyed by name.
 *
 * Returns what it finds rather than what it expects. A caller that needs a
 * specific stage should look it up and say so if it is missing — see
 * `requireStage` — so the failure names the stage instead of producing an empty
 * replay that reads as "nothing would change".
 */
export function coreStages(): Map<StageName, GatedStage> {
  const found = new Map<StageName, GatedStage>();
  for (const value of Object.values(core as Record<string, unknown>)) {
    if (isGatedStage(value)) found.set(value.name, value);
  }
  return found;
}

export function requireStage(name: StageName): GatedStage {
  const stage = coreStages().get(name);
  if (stage === undefined) {
    throw new Error(
      `@insidor/core does not export a replayable stage named "${name}". ` +
        'A replay that silently omits a stage reports "nothing would change".',
    );
  }
  return stage;
}

export interface GateRedeciderOptions {
  /** The reason written when every gate passes. From the stage's own vocabulary. */
  readonly passReason: ReasonCode;
  /**
   * Gate reasons that mean "we never asked", not "we said no". ABSTAIN and DROP
   * are different populations, and merging them poisons every recall number
   * downstream — so the split is declared here rather than inferred from a
   * prefix.
   */
  readonly abstainReasons: readonly ReasonCode[];
}

/**
 * A stage's hard gates as a re-decider. This is the workhorse: it answers
 * "which subjects would this threshold change admit or reject?" over any window
 * of the log, with no network and no key.
 */
export function gateRedecider(stage: GatedStage, opts: GateRedeciderOptions): Redecider {
  const abstain = new Set<ReasonCode>(opts.abstainReasons);
  return (f: FeatureVector, p: Policy): Redecision => {
    const blocked = stage.gate(f, p);
    if (blocked === null) return { verdict: 'pass', reason: opts.passReason, score: null };
    const verdict: Verdict = abstain.has(blocked) ? 'abstain' : 'drop';
    return { verdict, reason: blocked, score: null };
  };
}

export interface ScoredRedeciderOptions extends GateRedeciderOptions {
  readonly scorer: Scorer;
  /** The bar the score is compared against. Read off Policy by the caller. */
  readonly bar: (p: Policy) => number;
  readonly belowBarReason: ReasonCode;
}

/**
 * Gates first, then a model. The order is the product rule, not an
 * implementation detail: the deterministic gates run before the score and the
 * score cannot override them.
 *
 * The scorer must be pure and synchronous — `ml/serve` builds exactly that from
 * an artefact — which is what keeps a model replay as offline as a rule replay.
 */
export function scoredRedecider(stage: GatedStage, opts: ScoredRedeciderOptions): Redecider {
  const gated = gateRedecider(stage, opts);
  return (f: FeatureVector, p: Policy): Redecision => {
    const blocked = gated(f, p);
    if (blocked.verdict !== 'pass') return blocked;

    const s = opts.scorer.score(f);
    if (s < opts.bar(p)) return { verdict: 'drop', reason: opts.belowBarReason, score: s };
    return { verdict: 'pass', reason: opts.passReason, score: s };
  };
}
