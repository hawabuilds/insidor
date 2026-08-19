/**
 * DECISION — what every stage returns, and the only thing in this system that
 * cannot be reconstructed later.
 *
 * The decision happens in minutes; the answer arrives in days. Anything not written
 * down at the moment of the decision is gone, and every attempt to recover it after
 * the fact has produced a measurement that measured itself. Freezing the feature
 * vector here, before the outcome exists, makes that class of error impossible
 * rather than something to be careful about.
 *
 * Three fields are the ones people delete first and regret longest: `policyHash`
 * (without it no past decision is auditable after a threshold moves), `propensity`
 * (without it no counterfactual estimate is even defined), and `reason` (without it
 * a dead stage and a quiet night are the same row).
 */

import type { FeatureSetId, FeatureVector } from './features.ts';
import type { Millis } from './vocabulary.ts';
import type { ReasonCode } from './reasons.ts';

export const STAGE_NAMES = [
  'admit',
  'track',
  'detect',
  'group',
  'qualify',
  'resolve',
  'rank',
] as const;

export type StageName = (typeof STAGE_NAMES)[number];

export const VERDICTS = ['pass', 'hold', 'drop', 'abstain'] as const;

/**
 * `abstain` is not `drop`, and merging them poisons every recall number downstream:
 * "we looked and said no" and "we never asked" are different populations.
 */
export type Verdict = (typeof VERDICTS)[number];

export type SubjectKind = 'item' | 'story' | 'pair' | 'candidate';

/** Which randomisation lane produced this decision, if any. */
export type ExploreArm = 'epsilon' | 'holdout' | null;

export interface Decision {
  readonly stage: StageName;
  readonly subjectKind: SubjectKind;
  readonly subjectId: string;

  /**
   * THREE CLOCKS. Conflating any two is how lookahead comes back.
   *   featureAsOf   — the newest input datum the decider was allowed to see
   *   decidedAt     — when we chose
   *   subjectOrigin — when the thing itself began
   * The store enforces featureAsOf <= decidedAt as a CHECK constraint, so a future
   * refactor that reads a row written after the decision fails loudly instead of
   * quietly producing a better-looking model.
   */
  readonly featureAsOf: Millis;
  readonly decidedAt: Millis;
  readonly subjectOrigin: Millis | null;
  /**
   * decidedAt − subjectOrigin, in WHOLE seconds. Null when the origin is unknown.
   *
   * Whole, because `internal.decisions.horizon_s` is an `integer` and the value in
   * memory must be the value on disk — see `core/src/decide.ts`, which rounds it, and
   * which explains why the sub-second part was never a measurement in the first place.
   */
  readonly horizonS: number | null;

  readonly verdict: Verdict;
  /** From a closed list. Never free text. Never null, including on `pass`. */
  readonly reason: ReasonCode;
  /** null when a rule decided; a number when a model did. */
  readonly score: number | null;

  /** EXACTLY what the decider saw. Frozen here, before the outcome exists. */
  readonly features: FeatureVector;
  readonly featureSet: FeatureSetId;

  /** The thresholds it was judged against. Without this, nothing is auditable. */
  readonly policyHash: string;
  /** 'rule:qualify@3' today, 'gbdt:qualify@2026-11-02' later. The log does not care. */
  readonly decider: string;

  /** (0,1]. 1.0 for a deterministic rule. Off-policy evaluation is undefined without it. */
  readonly propensity: number;
  readonly explore: boolean;
  readonly exploreArm: ExploreArm;
  /** <1 when this row class is downsampled. A downsample you forgot to record is a biased set. */
  readonly logSampleRate: number;

  /** Set on a challenger's row; points at the champion's. Never set on a live decision. */
  readonly shadowOf: string | null;

  readonly costUsd: number;
}

/* ── the shape every stage has ────────────────────────────────────────── */

/**
 * Everything a stage may know about the outside world. The clock is a VALUE, not a
 * call. That is the whole trick: a stage cannot ask what time it is, so a replay six
 * months later gets the same answer as the original run.
 */
export interface StageContext {
  readonly now: Millis;
  readonly policyHash: string;
  /** Deterministic per subject; drives holdout and epsilon assignment across restarts. */
  readonly seed: string;
}

/**
 * The fields a stage supplies; the rest of a Decision is filled in by core's single
 * decision constructor, which is the only place horizonS, propensity and the clocks
 * are computed. Stages cannot get those wrong because stages do not write them.
 */
export interface DecisionDraft {
  readonly stage: StageName;
  readonly subjectKind: SubjectKind;
  readonly subjectId: string;
  readonly featureAsOf: Millis;
  readonly subjectOrigin: Millis | null;
  readonly verdict: Verdict;
  readonly reason: ReasonCode;
  readonly score: number | null;
  readonly features: FeatureVector;
  readonly featureSet: FeatureSetId;
  readonly decider: string;
  readonly costUsd: number;
  readonly explore?: boolean;
  readonly exploreArm?: ExploreArm;
  readonly propensity?: number;
  readonly logSampleRate?: number;
  readonly shadowOf?: string | null;
}

/**
 * decide() is SYNCHRONOUS on purpose. A function that cannot await cannot fetch,
 * cannot query, cannot call a hosted model, and cannot quietly recompute a feature
 * from fresher data than the one it logged. Everything a stage needs — including a
 * judge's answer — arrives as data on `Input`.
 */
export interface Stage<Input> {
  readonly name: StageName;
  readonly featureSet: FeatureSetId;
  extract(input: Input, ctx: StageContext): FeatureVector;
  /** Hard rules the model cannot argue with. Returns the blocking reason, or null. */
  gate(features: FeatureVector, policy: import('./policy.ts').Policy): ReasonCode | null;
  decide(input: Input, policy: import('./policy.ts').Policy, ctx: StageContext): Decision;
}
