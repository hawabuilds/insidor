/**
 * The promotion gates. Each test names the real failure the gate exists for.
 *
 * The fixture below is a PASSING challenger; every test breaks exactly one
 * thing. That shape matters: a gate that only ever runs against an already-bad
 * row can pass by accident, and this file's job is to prove each gate is the
 * thing that fired.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { StageName } from '@insidor/contracts';
import type { FeatureSetId } from '@insidor/contracts/features.ts';

import type { ArtefactMetadata } from '../artefact.ts';
import type { RegistryRow } from './registry.ts';
import { selectChampion, championAt } from './registry.ts';
import { checkPromotion } from './promote.ts';
import type { PromotionGate, PromotionPolicy } from './promote.ts';
import { hashFeatureNames } from '../feature-hash.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 2, 6, 0, 0);

const FEATURES = ['ageMin', 'distinctAuthors', 'memberCount'];

const POLICY: PromotionPolicy = {
  minShadowDays: 5,
  maxParityError: 1e-9,
  minParityRows: 1000,
  maxTrainingWindowAgeDays: 14,
  minTrainingRows: 5000,
  minTrainingPositives: 200,
};

function metadata(over: Partial<ArtefactMetadata> = {}): ArtefactMetadata {
  return {
    artefactId: 'gbdt:qualify@2026-11-01',
    stage: 'qualify' as StageName,
    featureSet: 'story.qualify.v1' as FeatureSetId,
    featureNames: FEATURES,
    featureHash: hashFeatureNames(FEATURES),
    trainedAt: NOW - DAY,
    trainingWindow: { fromMs: NOW - 180 * DAY, toMs: NOW - 7 * DAY, purgeDays: 6 },
    population:
      'qualify decisions, gated and holdout lanes, all sources, 2026-05-06..2026-10-26; ' +
      'label peak_multiple v1 over 6 days',
    label: { name: 'peak_multiple', version: 'v1', windowDays: 6 },
    datasetSql: { path: 'ml/train/sql/train_admit_v1.sql', sha256: 'a'.repeat(64) },
    rowCount: 41_000,
    positiveCount: 812,
    objective: 'binary sigmoid:1',
    sigmoid: 1,
    categoricalFeatures: 0,
    linearTree: false,
    parity: { rows: 1000, maxAbsError: 2.2e-16 },
    trainer: 'lightgbm==4.5.0',
    artefactSha256: 'b'.repeat(64),
    ...over,
  };
}

function row(over: Partial<RegistryRow> = {}, meta: Partial<ArtefactMetadata> = {}): RegistryRow {
  return {
    rowId: 'reg_002',
    stage: 'qualify' as StageName,
    role: 'challenger',
    artefactUri: 's3://insidor-models/qualify/2026-11-01.json',
    metadata: metadata(meta),
    promotedAt: null,
    retiredAt: null,
    shadowingSince: NOW - 9 * DAY,
    shadowOfRowId: 'reg_001',
    note: null,
    ...over,
  };
}

const champion = row({
  rowId: 'reg_001',
  role: 'champion',
  promotedAt: NOW - 30 * DAY,
  shadowingSince: null,
  shadowOfRowId: null,
});

const ctx = { now: NOW, policy: POLICY, fetchedArtefactSha256: 'b'.repeat(64) };

const gatesFor = (r: RegistryRow, c: RegistryRow | null = champion): PromotionGate[] =>
  checkPromotion(r, c, ctx).failures.map((f) => f.gate);

test('a clean challenger promotes', () => {
  const check = checkPromotion(row(), champion, ctx);
  assert.deepEqual(check.failures, []);
  assert.equal(check.ok, true);
  assert.equal(check.replacing, 'reg_001');
});

test('the first champion for a stage is legal and says so', () => {
  const check = checkPromotion(row(), null, ctx);
  assert.equal(check.ok, true);
  assert.equal(check.replacing, null);
});

test('a model that reads a different feature set cannot replace one that does not', () => {
  // Ship the feature set, let it accrue rows, then promote a model that reads it.
  const gates = gatesFor(row({}, { featureSet: 'story.qualify.v2' as FeatureSetId }));
  assert.ok(gates.includes('M3_feature_set_changed'));
});

test('a renamed feature under the same feature-set id is caught by the hash', () => {
  const renamed = ['ageMin', 'distinctAuthors', 'memberCount_v2'];
  const gates = gatesFor(row({}, { featureNames: renamed, featureHash: hashFeatureNames(renamed) }));
  assert.ok(gates.includes('M4_feature_hash_changed'));
});

test('a bucket overwritten in place is caught by the artefact sha', () => {
  const gates = checkPromotion(row(), champion, { ...ctx, fetchedArtefactSha256: 'c'.repeat(64) }).failures.map(
    (f) => f.gate,
  );
  assert.ok(gates.includes('M5_artefact_sha_mismatch'));
});

test('no parity fixture, no promotion — that fixture is why a second language is allowed', () => {
  assert.ok(gatesFor(row({}, { parity: null })).includes('M6_parity_missing'));
  assert.ok(gatesFor(row({}, { parity: { rows: 12, maxAbsError: 0 } })).includes('M6_parity_missing'));
  assert.ok(gatesFor(row({}, { parity: { rows: 1000, maxAbsError: 1e-3 } })).includes('M7_parity_error_too_large'));
});

test('a challenger must shadow-score before it is promoted', () => {
  assert.ok(gatesFor(row({ shadowingSince: null })).includes('M8_shadowed_too_briefly'));
  assert.ok(gatesFor(row({ shadowingSince: NOW - DAY })).includes('M8_shadowed_too_briefly'));
});

test('the trainer constraints the walker depends on are checked before deploy', () => {
  // The walker refuses these at load too. This gate makes the refusal happen at
  // 10am on a laptop rather than at 3am inside the runner.
  assert.ok(gatesFor(row({}, { categoricalFeatures: 4 })).includes('M13_trainer_unconstrained'));
  assert.ok(gatesFor(row({}, { linearTree: true })).includes('M13_trainer_unconstrained'));
});

test('a stale training window and a thin training set are both refused', () => {
  const stale = gatesFor(row({}, { trainingWindow: { fromMs: NOW - 400 * DAY, toMs: NOW - 60 * DAY, purgeDays: 6 } }));
  assert.ok(stale.includes('M10_training_window_stale'));
  assert.ok(gatesFor(row({}, { rowCount: 40 })).includes('M11_too_few_rows'));
  assert.ok(gatesFor(row({}, { positiveCount: 3 })).includes('M12_too_few_positives'));
});

test('every failure is reported, not just the first', () => {
  const bad = row({ role: 'retired', shadowingSince: null }, { parity: null, rowCount: 1 });
  const gates = gatesFor(bad);
  assert.ok(gates.length >= 4, `expected several failures, got ${gates.join(', ')}`);
});

test('two champions for one stage is an error, not a choice', () => {
  const a = row({ rowId: 'x', role: 'champion' });
  const b = row({ rowId: 'y', role: 'champion' });
  assert.throws(() => selectChampion([a, b], 'qualify' as StageName), /2 champions/);
  assert.equal(selectChampion([a], 'qualify' as StageName)?.rowId, 'x');
  assert.equal(selectChampion([], 'qualify' as StageName), null);
});

test('championAt reconstructs which model was live when a decision was written', () => {
  const first = row({ rowId: 'r1', role: 'retired', promotedAt: NOW - 60 * DAY, retiredAt: NOW - 30 * DAY });
  const second = row({ rowId: 'r2', role: 'champion', promotedAt: NOW - 30 * DAY });
  const rows = [first, second];
  assert.equal(championAt(rows, 'qualify' as StageName, NOW - 45 * DAY)?.rowId, 'r1');
  assert.equal(championAt(rows, 'qualify' as StageName, NOW - 1 * DAY)?.rowId, 'r2');
  assert.equal(championAt(rows, 'qualify' as StageName, NOW - 90 * DAY), null);
});
