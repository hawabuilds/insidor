/**
 * Isotonic calibration, on cases whose answer is arithmetic rather than
 * empirical: a pool of adjacent violators has exactly one weighted mean, and
 * clipping has exactly one value at each end.
 *
 * ★ THIS FILE STRADDLES THE TRAIN/SERVE LINE, WHICH IS WHY IT IS NOT REDUNDANT
 * WITH parity.test.ts. `fitIsotonic` runs on the TRAINING side — nightly, over
 * resolved labels — while `applyIsotonic` and `parseCalibration` run on the
 * SERVING side, in a request, with no label anywhere near them. isotonic.ts
 * separates the two so a recalibration cannot quietly become a retrain; these
 * tests are what hold each half to its own contract without the other present.
 *
 * The disagreement to be afraid of is between LANGUAGES, not between these
 * cases. `ml/train/export.py` fits the first calibrator with scikit-learn's
 * `IsotonicRegression` and writes its knots into the artefact sidecar; every
 * daily refit after that is `fitIsotonic` here, in TypeScript, with no Python in
 * the loop. If the two implementations diverge, the tree walk still matches, a
 * model-only parity check still passes, and every served probability is wrong —
 * policy bars are compared against the CALIBRATED number, so the whole board
 * shifts with nothing failing. parity.test.ts is the oracle for that, at 1e-12
 * on the fit and 1e-9 on the apply. THIS file is what still runs when the real
 * artefact fixture is absent, and it pins the semantics that the oracle can only
 * compare: pooling, tie merging, weights, and the out-of-bounds rule.
 *
 * The two tests that would be tempting to delete and must not be:
 *
 *   - CLIPPING, NEVER EXTRAPOLATION. The fixture is chosen so extrapolating the
 *     slope would give −0.4 and 1.4. Those are not probabilities, and nothing
 *     downstream range-checks them — a 1.4 becomes a rendered confidence.
 *   - AN EMPTY FIT IS REFUSED AT THE FIT. `applyIsotonic` also refuses a
 *     breakpoint-less calibrator, so this is belt and braces — but it decides
 *     WHERE the failure lands. Refused at fit, it is a nightly job that exits
 *     non-zero with nobody served. Left to apply, the same mistake surfaces as a
 *     throw inside a request, against an artefact that has already been promoted.
 *
 * ★ WHAT THESE TESTS DO NOT COVER: how many rows make a fit trustworthy.
 * `IsotonicCalibration.n` records the count and its own doc comment says a
 * calibrator fitted on eleven rows is a rumour, but nothing here — or in
 * isotonic.ts — enforces a floor. A two-point fit is arithmetically correct and
 * epistemically worthless, and it passes every assertion below. If a minimum is
 * ever wanted, it is a promotion gate (see registry/promote.ts), not a change to
 * the arithmetic this file pins.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { fitIsotonic, applyIsotonic, parseCalibration, CalibrationError } from './isotonic.ts';

test('an already-monotone sequence is returned unchanged', () => {
  const cal = fitIsotonic([
    { x: 0, y: 0 },
    { x: 1, y: 0.25 },
    { x: 2, y: 1 },
  ]);
  assert.equal(applyIsotonic(cal, 0), 0);
  assert.equal(applyIsotonic(cal, 1), 0.25);
  assert.equal(applyIsotonic(cal, 2), 1);
});

test('adjacent violators are pooled to their weighted mean', () => {
  // 0.9 then 0.1 violates monotonicity; both weight 1, so the pool is 0.5.
  const cal = fitIsotonic([
    { x: 0, y: 0 },
    { x: 1, y: 0.9 },
    { x: 2, y: 0.1 },
    { x: 3, y: 1 },
  ]);
  assert.equal(applyIsotonic(cal, 1), 0.5);
  assert.equal(applyIsotonic(cal, 2), 0.5);
});

test('weights move the pooled value, which is what inverse-propensity needs', () => {
  // 3:1 weighting of 1 against 0 pools to 0.75, not 0.5.
  const cal = fitIsotonic([
    { x: 1, y: 1, w: 3 },
    { x: 2, y: 0, w: 1 },
  ]);
  assert.equal(applyIsotonic(cal, 1), 0.75);
  assert.equal(applyIsotonic(cal, 2), 0.75);
});

test('ties on x merge into one point instead of counting as a violation', () => {
  // Two rows scored identically, one positive one negative. That is a single
  // point at 0.5, not a monotonicity failure that drags its neighbours.
  const cal = fitIsotonic([
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 1, y: 0 },
    { x: 2, y: 1 },
  ]);
  assert.equal(applyIsotonic(cal, 1), 0.5);
  assert.equal(applyIsotonic(cal, 2), 1);
});

test('out of bounds clips; it never extrapolates', () => {
  const cal = fitIsotonic([
    { x: 1, y: 0.2 },
    { x: 2, y: 0.8 },
  ]);
  // Extrapolating the slope would give −0.4 at x=0 and 1.4 at x=3. A calibrator
  // that emits 1.4 is a probability that will be rendered somewhere.
  assert.equal(applyIsotonic(cal, -100), 0.2);
  assert.equal(applyIsotonic(cal, 100), 0.8);
});

test('between breakpoints it interpolates linearly', () => {
  const cal = fitIsotonic([
    { x: 0, y: 0 },
    { x: 4, y: 1 },
  ]);
  assert.equal(applyIsotonic(cal, 1), 0.25);
  assert.equal(applyIsotonic(cal, 3), 0.75);
});

test('collinear interior points are dropped, so the artefact stays small', () => {
  const cal = fitIsotonic([
    { x: 0, y: 0 },
    { x: 1, y: 0.25 },
    { x: 2, y: 0.5 },
    { x: 3, y: 0.75 },
    { x: 4, y: 1 },
  ]);
  assert.deepEqual([...cal.x], [0, 4]);
  assert.equal(applyIsotonic(cal, 2), 0.5);
});

test('a non-monotone or malformed sidecar is refused at parse', () => {
  assert.throws(() => parseCalibration({ x: [0, 1], y: [1, 0] }), CalibrationError);
  assert.throws(() => parseCalibration({ x: [0, 1], y: [0] }), CalibrationError);
  assert.throws(() => parseCalibration({ x: [], y: [] }), CalibrationError);
  assert.throws(() => parseCalibration({ x: [0, 1], y: [0, 1], outOfBounds: 'nan' }), CalibrationError);
});

test('an empty fit is refused rather than producing a constant', () => {
  assert.throws(() => fitIsotonic([]), CalibrationError);
});
