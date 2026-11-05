/**
 * Auto buy's numbers as the sheet and the strip write them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { activeOf, capOf, solOf } from './format.ts';

test('SOL from whole lamports, trailing zeros dropped', () => {
  assert.equal(solOf(500_000_000), '0.5');
  assert.equal(solOf(250_000_000), '0.25');
  assert.equal(solOf(1_000_000_000), '1');
  assert.equal(solOf(255_000), '0.000255');
  assert.equal(solOf(1_010_510_000), '1.0105');
});

test('market caps and time on, as the choices write them', () => {
  assert.equal(capOf(25_000), '$25K');
  assert.equal(capOf(250_000), '$250K');
  assert.equal(capOf(1_000_000), '$1M');
  assert.equal(activeOf(86_400_000), '24 hours');
  assert.equal(activeOf(259_200_000), '3 days');
  assert.equal(activeOf(604_800_000), '7 days');
});
