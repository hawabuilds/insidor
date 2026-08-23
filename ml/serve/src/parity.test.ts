/**
 * ★ THE CI ORACLE. This file is the entire justification for allowing a second
 * language in this repository. Without it, do not split.
 *
 * It asserts that the TypeScript half reproduces the Python half on all THREE
 * things that cross the boundary — because only one of them was ever checked,
 * and it is not the most dangerous one:
 *
 *   1. THE TREE WALK.    `lgbm.ts` is a hand transcription of LightGBM's
 *      `Tree::NumericalDecision`. It is right to 2.2e-16 on the happy path and
 *      wrong by up to 0.98 — silently, no exception — on a categorical split, a
 *      linear tree, a mis-read sigmoid or a mishandled missing value.
 *
 *   2. THE CALIBRATOR.   LightGBM's dump does NOT contain it. If `isotonic.ts`
 *      and scikit-learn disagree, the tree walk still matches, a model-only
 *      parity test still passes, and every served probability is wrong. Policy
 *      bars are compared against a CALIBRATED number, so the whole board shifts
 *      with nothing failing. This had no oracle at all before today.
 *
 *   3. THE FEATURE HASH. If the two sides hash one key list differently, every
 *      artefact Python writes is rejected at load — or worse, champion-versus-
 *      challenger comparison compares two alphabets while looking fine.
 *
 * ── THE TWO FIXTURES, AND WHY THERE ARE TWO ────────────────────────────────
 *
 *   walker-parity.json   REQUIRED. Written by `ml/train/make_parity_oracle.py`
 *                        from a synthetic model. Answers "does this walker
 *                        implement LightGBM's arithmetic at all?" — a property
 *                        of the CODE, which needs no labels and no database, and
 *                        can therefore be asserted today and on every push. Its
 *                        rows are adversarial: exactly on thresholds, one ULP
 *                        either side, inside the ±1e-35 zero band, ±inf, and
 *                        all-missing. Nothing sampled from real data lands there.
 *
 *   parity.json          OPTIONAL, until there is a model. Written by
 *                        `ml/train/export.py` from the REAL training set.
 *                        Answers "does the walker reproduce THIS model, on the
 *                        rows it will actually meet?" There are no outcome
 *                        labels yet, so there is no model, so this file does not
 *                        exist and its test skips. Promotion gate
 *                        M6_parity_missing stops anything reaching production
 *                        while that is true.
 *
 * A missing walker-parity.json is a FAILURE, not a skip. That distinction is the
 * fix for the hole this file used to have: the only parity check in the
 * repository could not run until a training run existed, so the walker shipped
 * unverified for as long as the labels were missing — which is the entire life
 * of the project so far.
 *
 * ── THE TOLERANCES, AND WHY EACH ONE ───────────────────────────────────────
 *
 *   model + calibration apply   1e-9    Four orders looser than the float64
 *                                       rounding floor of 2.2e-16 a correct
 *                                       walker achieves, and eight orders
 *                                       tighter than the smallest known silent
 *                                       divergence (0.15 for a mis-read
 *                                       sigmoid). Nothing lands in between by
 *                                       accident, so a failure is always a
 *                                       semantic disagreement, never rounding.
 *
 *   isotonic fit                1e-12   Both sides compute block means as
 *                                       float64 sums in different orders over
 *                                       values in [0,1]; a few thousand points
 *                                       accumulate well under 1e-13. The
 *                                       smallest SEMANTIC disagreement — one
 *                                       pooling decision made differently —
 *                                       moves a fitted value by O(0.01) at
 *                                       least. Ten orders of clear air.
 *
 *   feature hash                exact   A digest has no tolerance.
 *
 * WHAT BREAKS IF THIS IS CHANGED CARELESSLY: raising a tolerance to make a red
 * test green converts a silent production divergence into a silent test. If one
 * of these fails, the walker and the trainer disagree about what a model MEANS,
 * and the number to change is in `lgbm.ts` or `isotonic.ts`, never here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { FeatureVector } from '@insidor/contracts/features.ts';
import { loadModel, predict } from './lgbm.ts';
import { applyIsotonic, fitIsotonic, parseCalibration } from './isotonic.ts';
import type { CalibrationPoint } from './isotonic.ts';
import { hashFeatureNames } from './feature-hash.ts';

const FIXTURES = new URL('../fixtures/', import.meta.url);
const WALKER = fileURLToPath(new URL('walker-parity.json', FIXTURES));
const ARTEFACT = fileURLToPath(new URL('parity.json', FIXTURES));
const MEASURED = fileURLToPath(new URL('parity-measured.json', FIXTURES));

/** Model output and calibrated probability. See the tolerance note above. */
const MAX_ABS_ERROR = 1e-9;
/** Two independent implementations of pool-adjacent-violators. */
const MAX_FIT_ERROR = 1e-12;

/* ── the fixture format ───────────────────────────────────────────────── */

/**
 * JSON carries no NaN and no Infinity, and Python's `json.dumps` emits bare
 * `NaN` / `Infinity` tokens that `JSON.parse` rejects. The generator encodes
 * them; this decodes them back. `null` is missing — the same meaning it carries
 * everywhere else in this system, where absent is deliberately not zero.
 */
type Encoded = number | string | null;

function decodeValue(v: Encoded): number | null {
  if (v === null) return null;
  if (v === '+inf') return Number.POSITIVE_INFINITY;
  if (v === '-inf') return Number.NEGATIVE_INFINITY;
  if (typeof v === 'number') return v;
  throw new Error(`unencodable fixture value ${JSON.stringify(v)}`);
}

function toVector(names: readonly string[], row: readonly Encoded[]): FeatureVector {
  const f: Record<string, number | null> = {};
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (name === undefined) continue;
    f[name] = decodeValue(row[i] ?? null);
  }
  return f as FeatureVector;
}

interface ModelCase {
  readonly name: string;
  readonly missingType: string;
  readonly model: unknown;
  readonly expectedPredict: readonly number[];
}

interface HashCase {
  readonly name: string;
  readonly names: readonly string[];
  readonly sha256: string;
}

interface IsotonicCase {
  readonly name: string;
  readonly points: readonly { readonly x: number; readonly y: number; readonly w: number }[];
  readonly sklearnKnots: { readonly x: readonly number[]; readonly y: readonly number[] };
  readonly queries: readonly number[];
  readonly expected: readonly number[];
}

interface WalkerFixture {
  readonly kind: string;
  readonly trainer: string;
  readonly featureNames: readonly string[];
  readonly rows: readonly (readonly Encoded[])[];
  readonly models: readonly ModelCase[];
  readonly calibration: unknown;
  readonly calibratedModel: string;
  readonly expectedCalibrated: readonly number[];
  readonly featureHashCases: readonly HashCase[];
  readonly isotonicFitCases: readonly IsotonicCase[];
}

/** Worst absolute error and the row it happened on. Reported, never averaged. */
interface Worst {
  readonly error: number;
  readonly at: number;
}

function worstOver(n: number, got: (i: number) => number, want: (i: number) => number): Worst {
  let error = 0;
  let at = -1;
  for (let i = 0; i < n; i++) {
    const e = Math.abs(got(i) - want(i));
    // Written as `!(e <= error)` so a NaN — which compares false against
    // everything — is recorded as the worst rather than skipped as "not worse".
    if (!(e <= error)) {
      error = e;
      at = i;
    }
  }
  return { error, at };
}

/* ── 1. the walker: required, adversarial, every push ─────────────────── */

const measurements: Record<string, unknown> = {};

test('the walker reproduces LightGBM on adversarial rows', () => {
  assert.ok(
    existsSync(WALKER),
    `no fixtures/walker-parity.json. This oracle needs no labels and no database — ` +
      `run \`python ml/train/make_parity_oracle.py\`. Until it exists the TypeScript walker ` +
      `has never been compared to the library it imitates, and the two-language split is unjustified.`,
  );

  const fx = JSON.parse(readFileSync(WALKER, 'utf8')) as WalkerFixture;
  assert.equal(fx.kind, 'walker-conformance', 'walker-parity.json is not a walker-conformance fixture');
  assert.ok(fx.rows.length >= 1000, `only ${fx.rows.length} rows; the oracle must be dense`);
  assert.ok(fx.models.length >= 1, 'the fixture carries no models');

  const vectors = fx.rows.map((row) => toVector(fx.featureNames, row));
  const perModel: Record<string, unknown> = {};

  for (const mc of fx.models) {
    const model = loadModel(mc.model);
    assert.deepEqual(
      [...model.featureNames],
      [...fx.featureNames],
      `${mc.name}: fixture feature order must match the model — split_feature is an index into it`,
    );
    assert.equal(
      mc.expectedPredict.length,
      fx.rows.length,
      `${mc.name}: predictions and rows must be 1:1`,
    );

    const scores = vectors.map((f) => predict(model, f));
    const w = worstOver(
      fx.rows.length,
      (i) => scores[i] ?? Number.NaN,
      (i) => mc.expectedPredict[i] ?? Number.NaN,
    );
    perModel[mc.name] = { rows: fx.rows.length, maxAbsError: w.error, missingType: mc.missingType };

    assert.ok(
      w.error <= MAX_ABS_ERROR,
      `${mc.name} (missing_type ${mc.missingType}): max |ts − py| = ${w.error} at row ${w.at}, ` +
        `limit ${MAX_ABS_ERROR}. This is a semantic divergence, not rounding — ` +
        `check missing_type, the sigmoid and the zero band. Row: ${JSON.stringify(fx.rows[w.at])}`,
    );
  }

  // The calibrator on top of the model, which is the number the product compares
  // a policy bar against.
  const cal = parseCalibration(fx.calibration);
  const target = fx.models.find((m) => m.name === fx.calibratedModel);
  assert.ok(target !== undefined, `calibratedModel ${fx.calibratedModel} is not in the fixture`);
  const calibrated = target.expectedPredict.map((raw) => applyIsotonic(cal, raw));
  const wc = worstOver(
    fx.expectedCalibrated.length,
    (i) => calibrated[i] ?? Number.NaN,
    (i) => fx.expectedCalibrated[i] ?? Number.NaN,
  );
  assert.ok(
    wc.error <= MAX_ABS_ERROR,
    `applyIsotonic disagrees with scikit-learn's predict by ${wc.error} at row ${wc.at}, ` +
      `limit ${MAX_ABS_ERROR}. The tree walk can be perfect while this is wrong, and every ` +
      `served probability would be wrong with it.`,
  );

  measurements['walker'] = {
    trainer: fx.trainer,
    rows: fx.rows.length,
    models: perModel,
    calibrationApplyMaxAbsError: wc.error,
    sha256: createHash('sha256').update(readFileSync(WALKER)).digest('hex'),
  };
});

/* ── 2. the feature hash: exact, both alphabets ───────────────────────── */

test('hashFeatureNames agrees with the Python feature hash, exactly', () => {
  assert.ok(existsSync(WALKER), 'no fixtures/walker-parity.json — run ml/train/make_parity_oracle.py');
  const fx = JSON.parse(readFileSync(WALKER, 'utf8')) as WalkerFixture;
  assert.ok(fx.featureHashCases.length > 0, 'the fixture carries no feature-hash cases');

  for (const c of fx.featureHashCases) {
    assert.equal(
      hashFeatureNames(c.names),
      c.sha256,
      `feature hash disagrees on "${c.name}" (${JSON.stringify(c.names)}). ` +
        `Python sorts by CODE POINT; JavaScript's default sort orders by UTF-16 code unit, and ` +
        `the two differ for any name above the Basic Multilingual Plane. Every artefact Python ` +
        `writes would be rejected at load — parseMetadata recomputes this and compares.`,
    );
  }
  measurements['featureHashCases'] = fx.featureHashCases.length;
});

/* ── 3. the calibrator's FIT, not only its apply ──────────────────────── */

test('fitIsotonic agrees with scikit-learn as a function', () => {
  assert.ok(existsSync(WALKER), 'no fixtures/walker-parity.json — run ml/train/make_parity_oracle.py');
  const fx = JSON.parse(readFileSync(WALKER, 'utf8')) as WalkerFixture;
  assert.ok(fx.isotonicFitCases.length > 0, 'the fixture carries no isotonic-fit cases');

  // ★ COMPARED AS A FUNCTION, NOT AS A KNOT ARRAY. Both implementations drop
  // redundant interior points and are entitled to drop different ones; two knot
  // lists can differ while describing the same piecewise-linear function. What
  // the product depends on is that the same score maps to the same probability.
  //
  // This is the layer with no oracle before today, and it is the one that
  // matters most: `isotonic.ts` says the DAILY recalibration runs fitIsotonic in
  // TypeScript with no Python anywhere near it. Every served probability comes
  // out of a calibrator this repository fitted itself.
  let worstAll = 0;
  let worstCase = '';
  for (const c of fx.isotonicFitCases) {
    const points: CalibrationPoint[] = c.points.map((p) => ({ x: p.x, y: p.y, w: p.w }));
    const fitted = fitIsotonic(points);
    const w = worstOver(
      c.queries.length,
      (i) => applyIsotonic(fitted, c.queries[i] ?? Number.NaN),
      (i) => c.expected[i] ?? Number.NaN,
    );
    if (w.error > worstAll) {
      worstAll = w.error;
      worstCase = c.name;
    }
    assert.ok(
      w.error <= MAX_FIT_ERROR,
      `fitIsotonic disagrees with scikit-learn on "${c.name}" by ${w.error} at query ` +
        `${c.queries[w.at]} (limit ${MAX_FIT_ERROR}). TypeScript fitted ${fitted.x.length} knots, ` +
        `scikit-learn ${c.sklearnKnots.x.length}. A different number of knots is legal; a ` +
        `different FUNCTION is a divergence in pool-adjacent-violators.`,
    );
  }
  measurements['isotonicFit'] = { cases: fx.isotonicFitCases.length, maxAbsError: worstAll, worstCase };
});

/* ── 4. the real artefact, the moment one exists ──────────────────────── */

test('the walker reproduces the trained model on real rows', (t) => {
  if (!existsSync(ARTEFACT)) {
    t.skip(
      'no fixtures/parity.json — ml/train/export.py has never produced a model, because ' +
        'internal.labels is empty. The walker itself is still verified by walker-parity.json ' +
        'above; this is the check that the SHIPPED model round-trips. A model cannot be ' +
        'promoted while this is skipping (gate M6_parity_missing).',
    );
    return;
  }

  const fx = JSON.parse(readFileSync(ARTEFACT, 'utf8')) as {
    readonly model: unknown;
    readonly calibration: unknown;
    readonly featureNames: readonly string[];
    readonly rows: readonly (readonly Encoded[])[];
    readonly expectedPredict: readonly number[];
    readonly expectedCalibrated: readonly number[] | null;
  };

  assert.ok(fx.rows.length >= 1000, `parity fixture has ${fx.rows.length} rows; expected at least 1000`);
  assert.equal(fx.rows.length, fx.expectedPredict.length, 'rows and predictions must be 1:1');

  const model = loadModel(fx.model);
  assert.deepEqual([...model.featureNames], [...fx.featureNames], 'fixture feature order must match the model');

  const scores = fx.rows.map((row) => predict(model, toVector(fx.featureNames, row)));
  const wm = worstOver(
    fx.rows.length,
    (i) => scores[i] ?? Number.NaN,
    (i) => fx.expectedPredict[i] ?? Number.NaN,
  );
  assert.ok(
    wm.error <= MAX_ABS_ERROR,
    `max |ts − py| = ${wm.error} at row ${wm.at}, limit ${MAX_ABS_ERROR}. ` +
      'This is a semantic divergence, not rounding — check missing_type, the sigmoid and the calibrator.',
  );

  // Reported separately from the model so a failure names the guilty layer.
  let calError = 0;
  if (fx.calibration !== null && fx.calibration !== undefined && fx.expectedCalibrated) {
    const cal = parseCalibration(fx.calibration);
    const wc = worstOver(
      fx.expectedCalibrated.length,
      (i) => applyIsotonic(cal, scores[i] ?? Number.NaN),
      (i) => (fx.expectedCalibrated ?? [])[i] ?? Number.NaN,
    );
    calError = wc.error;
    assert.ok(
      wc.error <= MAX_ABS_ERROR,
      `calibrated output disagrees by ${wc.error} at row ${wc.at}, limit ${MAX_ABS_ERROR}.`,
    );
  }

  measurements['artefact'] = {
    rows: fx.rows.length,
    modelMaxAbsError: wm.error,
    calibrationMaxAbsError: calError,
    sha256: createHash('sha256').update(readFileSync(ARTEFACT)).digest('hex'),
  };
});

/* ── 5. write the figure down, because nothing else measured it ───────── */

test('the measured parity is recorded for the promotion gate', () => {
  // ★ NOBODY ELSE MEASURES THIS. `export.py` used to write
  // `parity: {rows, maxAbsError: 0.0}` into the artefact sidecar with a comment
  // saying CI would overwrite it. Nothing did, and gate M7_parity_error_too_large
  // then graded a literal zero — the one gate whose entire purpose is to catch a
  // cross-language divergence, satisfied by a placeholder that could never be
  // anything but zero because Python was compared to Python.
  //
  // The measurement can only be made HERE, in the process that runs both halves.
  // So it is written here, and `python export.py --stamp` copies it into the
  // artefact only when the fixture digest matches. The artefact ships with
  // `parity: null` until then, and a null fails M6 loudly instead of a zero
  // passing M7 quietly.
  writeFileSync(
    MEASURED,
    `${JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        runtime: `node ${process.version}`,
        tolerances: { model: MAX_ABS_ERROR, calibrationApply: MAX_ABS_ERROR, isotonicFit: MAX_FIT_ERROR },
        ...measurements,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  assert.ok(measurements['walker'] !== undefined, 'the walker oracle did not run; nothing was measured');
});
