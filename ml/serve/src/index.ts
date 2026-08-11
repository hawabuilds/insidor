/**
 * The serving surface. Narrow on purpose: services wires an artefact into a
 * Policy's `scorers` map and nothing else in the system needs to know that a
 * model exists.
 *
 * The one name that matters is `makeScorer`. Everything else here is either
 * loading (which happens once, at process start or at a registry change) or the
 * registry types (which store/ implements).
 */

export { loadArtefact, parseMetadata, ArtefactError } from './artefact.ts';
export type { ArtefactFile, ArtefactMetadata, LoadedArtefact, LabelSpec, TrainingWindow } from './artefact.ts';

export { makeScorer, ScoringError } from './scorer.ts';
export type { ScorerOptions } from './scorer.ts';

export { loadModel, predict, rawScore, layout, applyLink, UnsupportedModelError } from './lgbm.ts';
export type { LoadedModel, Link, MissingKind } from './lgbm.ts';

export { fitIsotonic, applyIsotonic, parseCalibration, CalibrationError } from './isotonic.ts';
export type { IsotonicCalibration, CalibrationPoint } from './isotonic.ts';

export { hashFeatureNames, hashFeatureVector, hashArtefactBytes, hashArtefactBody, canonicalJson } from './feature-hash.ts';

export { selectChampion, championAt, servesFeatureSet, MODEL_ROLES } from './registry/registry.ts';
export type { ModelRegistryPort, ModelRole, RegistryRow } from './registry/registry.ts';

export { checkPromotion, describePromotion, PROMOTION_GATES } from './registry/promote.ts';
export type { PromotionCheck, PromotionContext, PromotionFailure, PromotionGate, PromotionPolicy } from './registry/promote.ts';
