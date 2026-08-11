/**
 * FEATURES — the frozen record of exactly what a decider looked at.
 *
 * WHY a bag of named numbers rather than a typed struct per stage: the feature set
 * will change weekly for the first year, and a typed struct means a contract edit,
 * a store migration and a coordinated deploy for every experiment. A bag that is
 * written down at decision time is what dissolves train/serve skew — the trainer
 * never recomputes a feature, it reads the one the decider actually used.
 *
 * WHY `number | null` and never `number | undefined`, and never a defaulted zero:
 * absent is a distinct state from zero and the trees consume it natively. A feature
 * that means "the source has no such concept" must not arrive as the same value as
 * "the source counted none".
 *
 * WHY Scorer lives here rather than in ml/: core must never import a model. A model
 * reaches a stage as a pure synchronous closure hanging off Policy, so "a rule
 * today, a model tomorrow" is one field, not a rewrite.
 */

/**
 * A feature-set version. The `.vN` suffix is required by the type, because a feature
 * set that changes shape without changing name silently poisons every training row
 * that shares its label window.
 */
export type FeatureSetId = `${string}.v${number}`;

/** Keys are stable, snake-free, stage-scoped names. Values carry absence honestly. */
export type FeatureVector = Readonly<Record<string, number | null>>;

/**
 * A scorer is pure and SYNCHRONOUS, and that is the guarantee, not a style choice:
 * a function that cannot await cannot fetch, cannot query, and cannot quietly
 * recompute a feature from data fresher than the vector it was handed.
 */
export interface Scorer {
  /** Written into Decision.decider verbatim, e.g. 'gbdt:qualify@2026-11-02'. */
  readonly id: string;
  /** The set this scorer was fit against. A mismatch is a load-time error, not a warning. */
  readonly featureSet: FeatureSetId;
  /** Calibrated to [0,1]. An uncalibrated score is not comparable to a policy bar. */
  score(features: FeatureVector): number;
}

/**
 * Which stages may currently be decided by a model. Every slot is nullable and every
 * one is null on day one; a stage with no scorer falls back to its rule, in its own
 * file, unchanged.
 */
export interface Scorers {
  readonly admit: Scorer | null;
  readonly track: Scorer | null;
  readonly detect: Scorer | null;
  readonly group: Scorer | null;
  readonly qualify: Scorer | null;
  readonly resolve: Scorer | null;
  readonly rank: Scorer | null;
}

/**
 * A challenger runs on the champion's frozen vector, immediately after it, and
 * changes nothing. Comparison becomes a query instead of a deploy.
 */
export interface Shadow {
  readonly scorer: Scorer;
  /** Recorded on the challenger's row so the pair can be joined. */
  readonly championDecider: string;
}
