/**
 * A loaded artefact, presented as the Scorer port from contracts.
 *
 * This is the entire production surface of machine learning in this system.
 * A stage's Policy carries `scorers.<stage>`; if one is present the stage calls
 * `scorer.score(features)` and writes `scorer.id` into the decision's `decider`
 * field; if it is absent the stage's own rule decides. The log does not care
 * which happened — 'rule:qualify@3' today, 'gbdt:qualify@2026-11-02' in
 * November, joined to the same labels through the same subject id.
 *
 * Three properties this file must not break:
 *
 *   SYNC. `score` returns a number, not a promise. A stage that could await
 *   could fetch, and a decider that can fetch can silently recompute a feature
 *   from fresher data than the one it logged. The tree walk is arithmetic, so
 *   this costs nothing.
 *
 *   PURE. No clock, no randomness, no I/O. The same vector scores the same
 *   forever, which is what makes the replay harness meaningful.
 *
 *   FEATURE-SET LOCKED. A scorer refuses to be built against a stage whose
 *   feature set it was not trained on. The alternative is a model reading
 *   `undefined` for every renamed feature, taking the missing branch on every
 *   row, and producing confident nonsense that looks like a bad week.
 */

import type { FeatureSetId, FeatureVector, Scorer } from '@insidor/contracts/features.ts';
import type { LoadedArtefact } from './artefact.ts';
import { ArtefactError } from './artefact.ts';
import { applyIsotonic } from './isotonic.ts';
import { layout, rawScore, applyLink } from './lgbm.ts';

export interface ScorerOptions {
  /**
   * The feature set the calling stage will hand in. Required: the check is the
   * point of the option, so there is no default that could skip it.
   */
  readonly expectFeatureSet: FeatureSetId;
  /**
   * Fraction of a model's features that may be absent from a vector before
   * scoring refuses. Sourced from Policy by the caller — no number is invented
   * here. Zero means "every feature must be present", which is the right
   * setting once the feature builders and the trainer agree.
   */
  readonly maxAbsentFeatureRatio: number;
}

export class ScoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScoringError';
  }
}

/**
 * Build the Scorer. Every check that can be done once is done here, at load, so
 * that `score()` is arithmetic and cannot throw for a structural reason.
 */
export function makeScorer(artefact: LoadedArtefact, opts: ScorerOptions): Scorer {
  const { metadata, model, calibration } = artefact;

  if (metadata.featureSet !== opts.expectFeatureSet) {
    throw new ArtefactError(
      `artefact ${metadata.artefactId} was trained on feature set "${metadata.featureSet}" ` +
        `and the stage will hand in "${opts.expectFeatureSet}". Retrain, or do not load it.`,
    );
  }

  if (opts.maxAbsentFeatureRatio < 0 || opts.maxAbsentFeatureRatio > 1) {
    throw new ArtefactError('maxAbsentFeatureRatio must be between 0 and 1');
  }

  const featureCount = model.featureNames.length;
  const absentBudget = Math.floor(featureCount * opts.maxAbsentFeatureRatio);

  const score = (f: FeatureVector): number => {
    const { values, absent } = layout(model, f);
    if (absent > absentBudget) {
      // Loud, not silent. A vector that has lost features relative to the model
      // is either a stage/model mismatch or vendor drift, and both need a human.
      throw new ScoringError(
        `${metadata.artefactId}: ${absent} of ${featureCount} model features are absent from the vector ` +
          `(budget ${absentBudget}). This is a feature-set drift, not a missing value.`,
      );
    }
    const raw = applyLink(model.link, rawScore(model, values));
    return calibration === null ? raw : applyIsotonic(calibration, raw);
  };

  return {
    id: metadata.artefactId,
    featureSet: metadata.featureSet,
    score,
  };
}
