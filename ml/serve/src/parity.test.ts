/**
 * ★ THE CI ORACLE. This test is the entire justification for allowing a second
 * language in this repository. Without it, do not split.
 *
 * `ml/train/export.py` writes `fixtures/parity.json`: the model, 1,000 real
 * feature rows drawn from the training set, and LightGBM's OWN predictions for
 * those rows. This asserts that the TypeScript walker reproduces them.
 *
 * The bar is 1e-9, which is four orders of magnitude looser than the float64
 * rounding floor of 2.2e-16 that a correct walker actually achieves, and eight
 * orders tighter than any of the known silent-divergence modes (0.15 for a
 * mis-read sigmoid, 0.34 for a linear tree, 0.92 for mishandled missing values,
 * 0.98 for a categorical split). Nothing lands between those bands by accident,
 * so a failure here always means a real semantic divergence.
 *
 * Until the first training run, there is no fixture and this skips loudly. The
 * moment `ml/registry` holds a champion row, an absent fixture must be a hard
 * failure — the promotion gate M6_parity_missing enforces that, so a model
 * cannot reach production while this test is skipping.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { FeatureVector } from '@insidor/contracts/features.ts';
import { loadModel, predict } from './lgbm.ts';
import { applyIsotonic, parseCalibration } from './isotonic.ts';

const FIXTURE = fileURLToPath(new URL('../fixtures/parity.json', import.meta.url));

/** The maximum absolute difference we accept between this walker and LightGBM. */
const MAX_ABS_ERROR = 1e-9;

interface ParityFixture {
  readonly model: unknown;
  readonly calibration: unknown;
  readonly featureNames: readonly string[];
  /** One row per prediction, values in featureNames order. null means missing. */
  readonly rows: readonly (readonly (number | null)[])[];
  /** LightGBM's own output for each row, calibration applied if present. */
  readonly expected: readonly number[];
}

test('the TypeScript walker reproduces LightGBM’s own predictions', (t) => {
  if (!existsSync(FIXTURE)) {
    t.skip(
      'no fixtures/parity.json — ml/train/export.py has never run. ' +
        'A model cannot be promoted while this is true (gate M6_parity_missing).',
    );
    return;
  }

  const fx = JSON.parse(readFileSync(FIXTURE, 'utf8')) as ParityFixture;
  assert.ok(fx.rows.length >= 1000, `parity fixture has ${fx.rows.length} rows; expected at least 1000`);
  assert.equal(fx.rows.length, fx.expected.length, 'rows and expected predictions must be 1:1');

  const model = loadModel(fx.model);
  assert.deepEqual([...model.featureNames], [...fx.featureNames], 'fixture feature order must match the model');

  const cal = fx.calibration === null || fx.calibration === undefined ? null : parseCalibration(fx.calibration);

  let worst = 0;
  let worstRow = -1;
  for (let i = 0; i < fx.rows.length; i++) {
    const values = fx.rows[i] ?? [];
    const f: Record<string, number | null> = {};
    for (let j = 0; j < fx.featureNames.length; j++) {
      const name = fx.featureNames[j];
      if (name === undefined) continue;
      f[name] = values[j] ?? null;
    }

    const raw = predict(model, f as FeatureVector);
    const got = cal === null ? raw : applyIsotonic(cal, raw);
    const err = Math.abs(got - (fx.expected[i] ?? Number.NaN));
    if (!(err <= worst)) {
      worst = err;
      worstRow = i;
    }
  }

  assert.ok(
    worst <= MAX_ABS_ERROR,
    `max |ts − py| = ${worst} at row ${worstRow}, limit ${MAX_ABS_ERROR}. ` +
      'This is a semantic divergence, not rounding — check missing_type, the sigmoid and the calibrator.',
  );
});
