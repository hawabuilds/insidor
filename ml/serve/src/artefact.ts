/**
 * The artefact: what crosses the Python/TypeScript boundary, and its sidecar.
 *
 * Two things cross that boundary and NEITHER IS CODE — a model file and one
 * registry row. That is the whole reason a two-language split is safe here. The
 * trainer never recomputes a feature; it reads the frozen vectors that
 * core/features/ wrote at decision time. So train/serve skew is not managed, it
 * is dissolved, and the boundary is data.
 *
 * The sidecar exists because a model file alone is unauditable. Six months from
 * now the only question that matters about a live model is "what was it trained
 * on, over what window, against which population" — and a number without its
 * population is what voided the last backtest. So `population` is required here
 * with no default, exactly as it is required on a label row.
 */

import type { Millis, StageName } from '@insidor/contracts';
import type { FeatureSetId } from '@insidor/contracts/features.ts';
import type { IsotonicCalibration } from './isotonic.ts';
import { parseCalibration } from './isotonic.ts';
import type { LoadedModel } from './lgbm.ts';
import { loadModel, UnsupportedModelError } from './lgbm.ts';
import { hashFeatureNames } from './feature-hash.ts';

/** The window a model was trained over, with its purge stated. */
export interface TrainingWindow {
  readonly fromMs: Millis;
  readonly toMs: Millis;
  /**
   * Days of examples dropped between train and test because their label window
   * overlapped the test period. A walk-forward split without a purge leaks:
   * an example decided on D−3 whose label window covers D shares outcome
   * information with the test set.
   */
  readonly purgeDays: number;
}

/** What the model was graded against. Never inferred; always written down. */
export interface LabelSpec {
  readonly name: string;
  readonly version: string;
  readonly windowDays: number;
}

/**
 * The sidecar. Everything here is a fact about the training run, and every
 * field is required, because an optional provenance field is an absent one.
 */
export interface ArtefactMetadata {
  /** 'qualify@2026-11-02T06:00Z'. Also the `decider` string written to the log. */
  readonly artefactId: string;
  readonly stage: StageName;

  /** The feature set the trainer read, and the hash of its exact key list. */
  readonly featureSet: FeatureSetId;
  readonly featureNames: readonly string[];
  readonly featureHash: string;

  readonly trainedAt: Millis;
  readonly trainingWindow: TrainingWindow;

  /**
   * ★ Required, no default. "Which rows was this fitted on" — 'admit decisions,
   * gated lane, English and non-English, 2026-05-01..2026-10-31'. The previous
   * backtest failed because its population was graduated coins, about 107 a day
   * against roughly 30,000 mints, while its claim was about coinability at large.
   */
  readonly population: string;
  readonly label: LabelSpec;

  /** The committed SQL that produced the training set, and its sha. */
  readonly datasetSql: { readonly path: string; readonly sha256: string };

  readonly rowCount: number;
  readonly positiveCount: number;

  /** The trainer's own constraint record, so a violation is visible in the row. */
  readonly objective: string;
  readonly sigmoid: number;
  readonly categoricalFeatures: number;
  readonly linearTree: boolean;

  /** Populated by export.py; the CI oracle asserts against it. */
  readonly parity: { readonly rows: number; readonly maxAbsError: number } | null;

  readonly trainer: string;
  readonly artefactSha256: string;
}

export interface ArtefactFile {
  readonly metadata: ArtefactMetadata;
  /** LightGBM's `booster.dump_model()` output, verbatim. */
  readonly model: unknown;
  /** Null when the model is served uncalibrated — legal, and visible. */
  readonly calibration: unknown;
}

/** An artefact after loading: validated, compiled, ready to score. */
export interface LoadedArtefact {
  readonly metadata: ArtefactMetadata;
  readonly model: LoadedModel;
  readonly calibration: IsotonicCalibration | null;
}

export class ArtefactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtefactError';
  }
}

/* ── runtime validation, because types erase ──────────────────────────── */

const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function str(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0) throw new ArtefactError(`metadata.${key} is missing`);
  return v;
}

function num(o: Record<string, unknown>, key: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ArtefactError(`metadata.${key} is not a finite number`);
  return v;
}

function bool(o: Record<string, unknown>, key: string): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') throw new ArtefactError(`metadata.${key} is missing`);
  return v;
}

const STAGES: readonly string[] = ['admit', 'track', 'detect', 'group', 'qualify', 'resolve', 'rank'];

export function parseMetadata(raw: unknown): ArtefactMetadata {
  const m = rec(raw);

  const stage = str(m, 'stage');
  if (!STAGES.includes(stage)) throw new ArtefactError(`metadata.stage "${stage}" is not a pipeline stage`);

  const names = m['featureNames'];
  if (!Array.isArray(names) || names.length === 0) throw new ArtefactError('metadata.featureNames is missing or empty');
  const featureNames: string[] = [];
  for (const n of names) {
    if (typeof n !== 'string' || n.length === 0) throw new ArtefactError('metadata.featureNames holds a non-string');
    featureNames.push(n);
  }

  const declaredHash = str(m, 'featureHash');
  const computedHash = hashFeatureNames(featureNames);
  if (declaredHash !== computedHash) {
    throw new ArtefactError(
      `metadata.featureHash does not match metadata.featureNames (declared ${declaredHash}, computed ${computedHash}). ` +
        'The sidecar was edited by hand or written by a trainer that hashes differently.',
    );
  }

  const win = rec(m['trainingWindow']);
  const label = rec(m['label']);
  const sql = rec(m['datasetSql']);
  const parityRaw = m['parity'];

  let parity: ArtefactMetadata['parity'] = null;
  if (parityRaw !== null && parityRaw !== undefined) {
    const p = rec(parityRaw);
    parity = { rows: num(p, 'rows'), maxAbsError: num(p, 'maxAbsError') };
  }

  const population = m['population'];
  if (typeof population !== 'string' || population.trim().length === 0) {
    throw new ArtefactError(
      'metadata.population is required and must be non-empty. A model whose population is ' +
        'undeclared cannot be reasoned about, and undeclared populations are what voided the last backtest.',
    );
  }

  return {
    artefactId: str(m, 'artefactId'),
    stage: stage as StageName,
    featureSet: str(m, 'featureSet') as FeatureSetId,
    featureNames,
    featureHash: declaredHash,
    trainedAt: num(m, 'trainedAt'),
    trainingWindow: { fromMs: num(win, 'fromMs'), toMs: num(win, 'toMs'), purgeDays: num(win, 'purgeDays') },
    population,
    label: { name: str(label, 'name'), version: str(label, 'version'), windowDays: num(label, 'windowDays') },
    datasetSql: { path: str(sql, 'path'), sha256: str(sql, 'sha256') },
    rowCount: num(m, 'rowCount'),
    positiveCount: num(m, 'positiveCount'),
    objective: str(m, 'objective'),
    sigmoid: num(m, 'sigmoid'),
    categoricalFeatures: num(m, 'categoricalFeatures'),
    linearTree: bool(m, 'linearTree'),
    parity,
    trainer: str(m, 'trainer'),
    artefactSha256: str(m, 'artefactSha256'),
  };
}

/**
 * Load and validate an artefact file.
 *
 * Beyond the per-field checks this asserts one cross-field invariant that no
 * single validator can: the model's own `feature_names` must be exactly the
 * sidecar's `featureNames`, in the same order. `split_feature` is an INDEX into
 * that array. A sidecar listing the same names in a different order would pass
 * the feature-hash check — the hash is order-insensitive by design — and then
 * every split would read the wrong column.
 */
export function loadArtefact(raw: unknown): LoadedArtefact {
  const file = rec(raw);
  const metadata = parseMetadata(file['metadata']);

  let model: LoadedModel;
  try {
    model = loadModel(file['model']);
  } catch (e: unknown) {
    if (e instanceof UnsupportedModelError) throw e;
    throw new ArtefactError(`model failed to load: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (model.featureNames.length !== metadata.featureNames.length) {
    throw new ArtefactError(
      `model has ${model.featureNames.length} features, sidecar declares ${metadata.featureNames.length}`,
    );
  }
  for (let i = 0; i < model.featureNames.length; i++) {
    if (model.featureNames[i] !== metadata.featureNames[i]) {
      throw new ArtefactError(
        `feature ${i} is "${String(model.featureNames[i])}" in the model and ` +
          `"${String(metadata.featureNames[i])}" in the sidecar. split_feature is an index into this order.`,
      );
    }
  }

  const calibration = file['calibration'] === null || file['calibration'] === undefined
    ? null
    : parseCalibration(file['calibration']);

  return { metadata, model, calibration };
}
