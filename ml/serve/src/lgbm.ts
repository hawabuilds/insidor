/**
 * A LightGBM tree ensemble, walked in TypeScript.
 *
 * WHY THIS EXISTS: Python trains and never runs in production. A gradient-boosted
 * tree is a few hundred KB of JSON and a tree walk, which is arithmetic in any
 * language, so serving needs no Python runtime, no ONNX, and no native binary.
 *
 * WHY IT IS SHAPED LIKE THIS: a naive walker — `x <= threshold ? left : right` —
 * reproduces LightGBM's own predictions to 2.2e-16 on numeric features with no
 * missing values, and is wrong by up to 0.98 in probability space on four other
 * model variants, SILENTLY. No exception, no warning, just different numbers.
 * The nastiest is categorical: the dump emits the threshold as the string
 * "0||1||2||7", `x <= "0||1||2||7"` coerces to NaN, evaluates false, and every
 * row takes the right branch forever. A model wrong by 0.9 looks like a bad week,
 * not like a bug.
 *
 * So two rules govern this file and neither is negotiable:
 *
 *   1. Implement LightGBM's ACTUAL decision semantics, including the NaN-to-zero
 *      coercion and the default-branch rules. They are transcribed from
 *      Tree::NumericalDecision, not guessed.
 *   2. THROW AT LOAD on anything not implemented. Never fall through, never
 *      default, never coerce. `loadModel` is the only place that can refuse, and
 *      a refusal at deploy time is worth any number of quiet wrong probabilities.
 *
 * The trainer is constrained to match (categorical_feature=[], linear_tree=False,
 * sigmoid=1.0 set explicitly in ml/train/train.py). This file is the enforcement
 * of that constraint, not its documentation: a model that violates it does not load.
 */

import type { FeatureVector } from '@insidor/contracts/features.ts';

/** Thrown at load. Never at predict time — predict cannot fail on a loaded model. */
export class UnsupportedModelError extends Error {
  readonly where: string;

  constructor(where: string, message: string) {
    super(`${where}: ${message}`);
    this.name = 'UnsupportedModelError';
    this.where = where;
  }
}

/* ── the compiled form ────────────────────────────────────────────────── */

/**
 * Missing-value handling, as three cases rather than a string compared at every
 * node. LightGBM writes "None" | "Zero" | "NaN" into each split.
 */
export type MissingKind = 'none' | 'zero' | 'nan';

interface CompiledSplit {
  readonly kind: 'split';
  readonly feature: number;
  readonly threshold: number;
  readonly missing: MissingKind;
  readonly defaultLeft: boolean;
  readonly left: CompiledNode;
  readonly right: CompiledNode;
}

interface CompiledLeaf {
  readonly kind: 'leaf';
  readonly value: number;
}

type CompiledNode = CompiledSplit | CompiledLeaf;

/** How raw ensemble output becomes the number the rest of the system reads. */
export type Link =
  | { readonly kind: 'identity' }
  | { readonly kind: 'logistic'; readonly sigmoid: number };

export interface LoadedModel {
  /** In the order `split_feature` indexes. Prediction reads features BY NAME. */
  readonly featureNames: readonly string[];
  readonly link: Link;
  readonly objective: string;
  readonly trees: readonly CompiledNode[];
}

/* ── narrow readers, because a dump is `unknown` until proven otherwise ── */

const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const isRec = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/* ── loading ──────────────────────────────────────────────────────────── */

/**
 * LightGBM's `booster.dump_model()` output, validated and compiled.
 *
 * Everything this walker does not implement is rejected here by name, so the
 * failure says which model feature is missing rather than producing a number.
 */
export function loadModel(raw: unknown): LoadedModel {
  const m = rec(raw);
  const at = 'model';

  if (!isRec(raw)) throw new UnsupportedModelError(at, 'dump is not an object');

  const numClass = m['num_class'];
  if (numClass !== undefined && numClass !== 1) {
    throw new UnsupportedModelError(
      at,
      `num_class=${String(numClass)}; only single-output models are served. ` +
        'Multiclass would need one score per class and a different Scorer port.',
    );
  }

  const perIteration = m['num_tree_per_iteration'];
  if (perIteration !== undefined && perIteration !== 1) {
    throw new UnsupportedModelError(at, `num_tree_per_iteration=${String(perIteration)}; expected 1`);
  }

  // Random-forest mode averages instead of summing. Different arithmetic entirely.
  if (m['average_output'] === true) {
    throw new UnsupportedModelError(at, 'average_output=true (random forest mode) is not implemented');
  }

  const names = m['feature_names'];
  if (!Array.isArray(names) || names.length === 0) {
    throw new UnsupportedModelError(at, 'feature_names is missing or empty');
  }
  const featureNames: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    if (typeof n !== 'string' || n.length === 0) {
      throw new UnsupportedModelError(at, `feature_names[${i}] is not a non-empty string`);
    }
    featureNames.push(n);
  }

  const objective = typeof m['objective'] === 'string' ? m['objective'] : '';
  const link = parseLink(objective);

  const info = m['tree_info'];
  if (!Array.isArray(info) || info.length === 0) {
    throw new UnsupportedModelError(at, 'tree_info is missing or empty');
  }

  const trees: CompiledNode[] = [];
  for (let t = 0; t < info.length; t++) {
    const tree = rec(info[t]);
    if (tree['num_cat'] !== undefined && tree['num_cat'] !== 0) {
      throw new UnsupportedModelError(
        `tree[${t}]`,
        `num_cat=${String(tree['num_cat'])}; categorical splits are not implemented. ` +
          'Train with categorical_feature=[].',
      );
    }
    trees.push(compileNode(tree['tree_structure'], `tree[${t}]`, featureNames.length));
  }

  return { featureNames, link, objective, trees };
}

/**
 * `"binary sigmoid:1"` → logistic with that sigmoid. The sigmoid factor is
 * parsed rather than assumed: a model trained with sigmoid=2.0 and served as if
 * it were 1.0 is wrong by ~0.15 in probability space and looks plausible.
 */
function parseLink(objective: string): Link {
  const parts = objective.split(/\s+/).filter(Boolean);
  const name = parts[0] ?? '';

  const sigmoidOf = (): number => {
    for (const p of parts.slice(1)) {
      if (p.startsWith('sigmoid:')) {
        const v = Number(p.slice('sigmoid:'.length));
        if (!Number.isFinite(v) || v <= 0) {
          throw new UnsupportedModelError('objective', `unreadable sigmoid in "${objective}"`);
        }
        return v;
      }
    }
    // LightGBM always writes it for binary. Its absence means we are reading a
    // dump we do not understand, and guessing 1.0 would be the silent-wrong path.
    throw new UnsupportedModelError('objective', `binary objective without a sigmoid: "${objective}"`);
  };

  switch (name) {
    case 'binary':
      return { kind: 'logistic', sigmoid: sigmoidOf() };
    case 'cross_entropy':
      // Fixed sigmoid of 1 by definition; LightGBM writes no sigmoid token.
      return { kind: 'logistic', sigmoid: 1 };
    case 'regression':
    case 'regression_l1':
    case 'huber':
    case 'quantile':
    case 'lambdarank':
      return { kind: 'identity' };
    default:
      throw new UnsupportedModelError('objective', `"${objective}" is not implemented`);
  }
}

function compileNode(raw: unknown, at: string, featureCount: number): CompiledNode {
  const n = rec(raw);
  if (!isRec(raw)) throw new UnsupportedModelError(at, 'node is not an object');

  // linear_tree=True puts a linear model in every leaf. Summing `leaf_value`
  // alone is then wrong by ~0.34, with no structural hint that anything is off.
  if (n['leaf_coeff'] !== undefined || n['leaf_features'] !== undefined) {
    throw new UnsupportedModelError(at, 'linear tree leaves are not implemented. Train with linear_tree=False.');
  }

  if (n['left_child'] === undefined && n['right_child'] === undefined) {
    const value = n['leaf_value'];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new UnsupportedModelError(at, 'leaf has no finite leaf_value');
    }
    return { kind: 'leaf', value };
  }

  const decisionType = n['decision_type'];
  if (decisionType !== '<=') {
    throw new UnsupportedModelError(
      at,
      `decision_type=${JSON.stringify(decisionType)} is not implemented. ` +
        'Only numeric "<=" splits are served; "==" is a categorical split.',
    );
  }

  const threshold = n['threshold'];
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) {
    // A categorical threshold arrives here as the string "0||1||2||7".
    throw new UnsupportedModelError(at, `threshold ${JSON.stringify(threshold)} is not a finite number`);
  }

  const feature = n['split_feature'];
  if (typeof feature !== 'number' || !Number.isInteger(feature) || feature < 0 || feature >= featureCount) {
    throw new UnsupportedModelError(at, `split_feature ${String(feature)} is out of range`);
  }

  const defaultLeft = n['default_left'];
  if (typeof defaultLeft !== 'boolean') {
    throw new UnsupportedModelError(at, 'default_left is missing');
  }

  return {
    kind: 'split',
    feature,
    threshold,
    missing: parseMissing(n['missing_type'], at),
    defaultLeft,
    left: compileNode(n['left_child'], `${at}.left`, featureCount),
    right: compileNode(n['right_child'], `${at}.right`, featureCount),
  };
}

function parseMissing(raw: unknown, at: string): MissingKind {
  switch (raw) {
    case 'None':
      return 'none';
    case 'Zero':
      return 'zero';
    case 'NaN':
      return 'nan';
    default:
      throw new UnsupportedModelError(at, `missing_type ${JSON.stringify(raw)} is not implemented`);
  }
}

/* ── prediction ───────────────────────────────────────────────────────── */

/**
 * LightGBM's own zero band. Not an epsilon we chose — `kZeroThreshold` in
 * `include/LightGBM/meta.h`. A value inside it counts as zero for a Zero-missing
 * split, and the row then takes the default branch rather than comparing.
 */
const ZERO_BAND = 1e-35;

const isZero = (v: number): boolean => v > -ZERO_BAND && v <= ZERO_BAND;

/**
 * Transcribed from LightGBM's `Tree::NumericalDecision`. The order of the three
 * clauses is the whole correctness argument, so it is written out flat rather
 * than compressed:
 *
 *   1. A NaN under a non-NaN missing_type is COERCED TO ZERO first. It is then
 *      an ordinary value — which for missing_type=Zero means it lands in the
 *      zero band and takes the default branch, and for missing_type=None means
 *      it is compared against the threshold as 0.
 *   2. A value that counts as "missing" for this split takes default_left.
 *   3. Everything else compares.
 */
function goLeft(value: number, node: CompiledSplit): boolean {
  let v = value;
  if (Number.isNaN(v) && node.missing !== 'nan') v = 0;

  if ((node.missing === 'zero' && isZero(v)) || (node.missing === 'nan' && Number.isNaN(v))) {
    return node.defaultLeft;
  }
  return v <= node.threshold;
}

function walk(node: CompiledNode, values: readonly number[]): number {
  let cur = node;
  while (cur.kind === 'split') {
    // Out of range is impossible: the value array is built from featureNames.
    const v = values[cur.feature] ?? Number.NaN;
    cur = goLeft(v, cur) ? cur.left : cur.right;
  }
  return cur.value;
}

/**
 * The ensemble sum, before the link. Exposed because it is the number the
 * parity fixture compares and the number a calibrator is fitted on.
 *
 * Note there is no per-tree shrinkage term: LightGBM has already multiplied it
 * into `leaf_value` by the time it dumps, and the `shrinkage` field is a record
 * of that, not an instruction. Applying it again would scale every prediction.
 */
export function rawScore(model: LoadedModel, values: readonly number[]): number {
  let sum = 0;
  for (const tree of model.trees) sum += walk(tree, values);
  return sum;
}

export function applyLink(link: Link, raw: number): number {
  if (link.kind === 'identity') return raw;
  return 1 / (1 + Math.exp(-link.sigmoid * raw));
}

/**
 * Lay a FeatureVector out in the model's own feature order.
 *
 * ★ null becomes NaN, and that is the point. In our vocabulary null means "we
 * have no reading" — absent is deliberately distinct from zero everywhere in
 * this system, and NaN is how that distinction survives into the tree, where
 * LightGBM's missing-value branch handles it. Writing 0 here would tell the
 * model that an unread counter is a counter reading zero, which is the same
 * class of mistake as publishing a zero rate for a censored observation.
 *
 * A feature the model wants and the vector does not carry is ALSO NaN, and is
 * counted, because a feature that silently goes missing for new rows while old
 * rows stay populated is the signature of vendor drift and is invisible to any
 * aggregate null check.
 */
export function layout(model: LoadedModel, f: FeatureVector): { values: number[]; absent: number } {
  const values: number[] = new Array<number>(model.featureNames.length).fill(Number.NaN);
  let absent = 0;
  for (let i = 0; i < model.featureNames.length; i++) {
    const name = model.featureNames[i];
    if (name === undefined) continue;
    const v = f[name];
    if (v === undefined) {
      absent++;
      continue;
    }
    if (v === null) continue;
    values[i] = v;
  }
  return { values, absent };
}

/** The prediction, link applied. Pure and synchronous — safe inside a Scorer. */
export function predict(model: LoadedModel, f: FeatureVector): number {
  const { values } = layout(model, f);
  return applyLink(model.link, rawScore(model, values));
}
