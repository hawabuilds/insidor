/**
 * ★ THE DECISION CONSTRUCTOR. Every stage in this package returns one of these and
 * no stage builds one by hand.
 *
 * WHY it is centralised: a Decision is the row that later joins to an outcome, and
 * that join is the entire machine-learning plan. The decision happens in minutes;
 * the label arrives in days. Anything not written down here is gone — not
 * "expensive to recover", gone — because the world the features described no longer
 * exists by the time the answer does.
 *
 * So the three fields most likely to be dropped by a stage in a hurry are computed
 * here instead of being passed in:
 *
 *   decidedAt   — the clock, taken from ctx, never from a call. A stage that could
 *                 read the clock could read a fresher clock than the one its
 *                 features were built against, and that is lookahead.
 *   horizonS    — decidedAt − subjectOrigin. The single most useful column for
 *                 asking "how early were we?", and impossible to reconstruct once
 *                 the origin has been overwritten by a later correction.
 *   propensity  — how likely this action was. A deterministic rule is 1.0. Without
 *                 it, every counterfactual estimate over this log is undefined, and
 *                 no amount of later cleverness recovers it.
 *
 * The two invariants below throw rather than coerce. Both are conditions the store
 * enforces as CHECK constraints, and a row that fails there fails after the side
 * effect has already happened. Failing here fails before it.
 */

import type { Decision, DecisionDraft, StageContext } from '@insidor/contracts/decision.ts';

import { MS_PER_SECOND } from './math.ts';


/**
 * @param draft what the stage decided, and the frozen vector it decided on
 * @param ctx   the clock, the policy hash in force, and the subject's seed
 */
export function decide(draft: DecisionDraft, ctx: StageContext): Decision {
  const decidedAt = ctx.now;

  // No lookahead. The newest datum the decider saw cannot postdate the decision.
  if (draft.featureAsOf > decidedAt) {
    throw new RangeError(
      `decide(${draft.stage}): featureAsOf ${draft.featureAsOf} is after decidedAt ${decidedAt}`,
    );
  }

  const propensity = draft.propensity ?? 1;
  if (!(propensity > 0 && propensity <= 1)) {
    throw new RangeError(`decide(${draft.stage}): propensity ${propensity} is outside (0,1]`);
  }

  const exploreArm = draft.exploreArm ?? null;

  return Object.freeze({
    stage: draft.stage,
    subjectKind: draft.subjectKind,
    subjectId: draft.subjectId,

    featureAsOf: draft.featureAsOf,
    decidedAt,
    subjectOrigin: draft.subjectOrigin,
    /*
     * ★ WHOLE SECONDS, AND THE ROUNDING IS THE POINT RATHER THAN A TIDY-UP.
     *
     * Found by the first decision ever written to a database: `internal.decisions`
     * declares `horizon_s integer`, this returned 23507.164, and Postgres answered
     * `invalid input syntax for type integer`. Every row whose subject had a post
     * time was rejected; the only ones that landed were the ones with no origin at
     * all, where this is null. A bug that is invisible until the first real write is
     * exactly the kind an empty log hides.
     *
     * Rounding here rather than in the store, for two reasons. The column is the
     * system of record, so the value held in memory and the value on disk should be
     * the same number — a store that quietly rounded on the way in would make a
     * decision read back differ from the decision that was taken. And the precision
     * was never real: `decidedAt` is a poll-cadence clock and `subjectOrigin` is a
     * source's own post time, which is minute-resolution at best on most of them.
     * Millisecond horizons are false precision, and false precision that a column
     * silently truncates is worse than either honest end of it.
     */
    horizonS:
      draft.subjectOrigin === null
        ? null
        : Math.round((decidedAt - draft.subjectOrigin) / MS_PER_SECOND),

    verdict: draft.verdict,
    reason: draft.reason,
    score: draft.score,

    // Frozen, not copied: the vector must be the object the decider actually read,
    // and it must be impossible for a later stage to edit it before it is written.
    features: Object.freeze(draft.features),
    featureSet: draft.featureSet,

    policyHash: ctx.policyHash,
    decider: draft.decider,

    propensity,
    // A held-back slot is a lane, not a flag: `explore` follows from the arm, so
    // the two can never disagree in the log the way two hand-set fields would.
    explore: draft.explore ?? exploreArm !== null,
    exploreArm,
    logSampleRate: draft.logSampleRate ?? 1,

    shadowOf: draft.shadowOf ?? null,

    costUsd: draft.costUsd,
  });
}
