/**
 * Isotonic calibration, on cases whose answer is arithmetic rather than
 * empirical: a pool of adjacent violators has exactly one weighted mean, and
 * clipping has exactly one value at each end.
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
