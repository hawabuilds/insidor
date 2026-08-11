/**
 * What ADMIT must be true of, stated as the failures it is a repair of.
 *
 * The seeds below are literal on purpose. Lane assignment is a pure function of the
 * seed, so a lane is reproducible forever — which is the property the holdout is
 * worth having for. A test that searched for a qualifying seed would pass even if
 * assignment stopped being deterministic.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { StageContext } from '@insidor/contracts/decision.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import type { Item } from '@insidor/contracts/vocabulary.ts';

import { admit, extract, type AdmitInput } from './stage.ts';

const SOURCE = sourceId('testsrc');
const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

/** A seed that lands in the two-percent holdout under the default salt and rate. */
const HELD_BACK_SEED = 'item-62';
/** A seed in neither lane, so gates and the bar are what decide. */
const ORDINARY_SEED = 'item-0';

function ctx(seed: string): StageContext {
  return { now: NOW, policyHash: 'test-policy-hash', seed };
}

function item(over: Partial<Item> = {}): Item {
  return {
    itemId: itemId(SOURCE, 'i1'),
    source: SOURCE,
    sourceItemId: 'i1',
    authorKey: authorKey(SOURCE, 'a1'),
    postedAt: NOW - 10 * MINUTE,
    firstSeenAt: NOW - 9 * MINUTE,
    lang: null,
    text: 'a picture of a small hippo',
    media: [{ kind: 'image', uri: 'blob://x', width: null, height: null, durationMs: null }],
    counters: {},
    fingerprints: [],
    rebroadcastOf: null,
    reproductionOf: null,
    formatIds: [],
    rawRef: 'blob://raw',
    ...over,
  };
}

function input(over: Partial<AdmitInput> = {}): AdmitInput {
  return {
    item: item(),
    author: null,
    carrierAcceleration: null,
    admissionBar: 0.2,
    alreadyAdmitted: false,
    authorSuppressed: false,
    budgetExhausted: false,
    costUsd: 0,
    ...over,
  };
}

test('a rebroadcast is dropped: it created no new authored object', () => {
  const d = admit(
    input({ item: item({ rebroadcastOf: itemId(SOURCE, 'parent') }) }),
    DEFAULT_POLICY,
    ctx(ORDINARY_SEED),
  );

  assert.equal(d.verdict, 'drop');
  assert.equal(d.reason, 'A1_rebroadcast_not_original');
  assert.equal(d.score, null);
});

test('an item with neither text nor media is dropped', () => {
  const d = admit(
    input({ item: item({ text: '   ', media: [] }) }),
    DEFAULT_POLICY,
    ctx(ORDINARY_SEED),
  );

  assert.equal(d.verdict, 'drop');
  assert.equal(d.reason, 'A2_empty');
});

test('a held-back arrival is admitted with every gate bypassed', () => {
  // A rebroadcast would be dropped in the ordinary lane. In the holdout it is
  // admitted anyway, because the holdout measures what the gates get wrong and a
  // holdout filtered by the gates measures nothing.
  const d = admit(
    input({ item: item({ rebroadcastOf: itemId(SOURCE, 'parent') }) }),
    DEFAULT_POLICY,
    ctx(HELD_BACK_SEED),
  );

  assert.equal(d.verdict, 'pass');
  assert.equal(d.reason, 'A10_holdout_admitted');
  assert.equal(d.exploreArm, 'holdout');
  assert.equal(d.explore, true);
  assert.equal(d.propensity, DEFAULT_POLICY.explore.holdoutRate);
});

test('an eligible item we cannot pay for is held, not dropped', () => {
  const d = admit(input({ budgetExhausted: true }), DEFAULT_POLICY, ctx(ORDINARY_SEED));

  assert.equal(d.verdict, 'hold');
  assert.equal(d.reason, 'A9_budget_exhausted');
});

test('scoring under the bar drops, and records the bar it was judged against', () => {
  const d = admit(input({ admissionBar: 0.99 }), DEFAULT_POLICY, ctx(ORDINARY_SEED));

  assert.equal(d.verdict, 'drop');
  assert.equal(d.reason, 'A4_score_below_bar');
  assert.equal(d.features.admissionBar, 0.99);
  assert.equal(d.policyHash, 'test-policy-hash');
  assert.equal(d.logSampleRate, DEFAULT_POLICY.explore.dropLogSampleRate);
});

test('nothing gates on an absolute counter: an item with no counters at all can pass', () => {
  // A source with no public reach count must remain detectable. The build this
  // replaces hardcoded a view floor, which would have made one silently invisible.
  const d = admit(
    input({ item: item({ counters: {} }), admissionBar: 0.1 }),
    DEFAULT_POLICY,
    ctx(ORDINARY_SEED),
  );

  assert.equal(d.verdict, 'pass');
  assert.equal(d.reason, 'A0_admitted');
  assert.equal(d.propensity, 1);
  assert.equal(d.exploreArm, null);
});

test('an absent reproduction counter is null in the vector, never zero', () => {
  const f = extract(input({ item: item({ counters: {} }) }), ctx(ORDINARY_SEED));

  assert.equal(f.reproductionLevel, null);
  assert.notEqual(f.reproductionLevel, 0);
});

test('the decision carries the three clocks, and the features are frozen', () => {
  const d = admit(input(), DEFAULT_POLICY, ctx(ORDINARY_SEED));

  assert.equal(d.decidedAt, NOW);
  assert.equal(d.subjectOrigin, NOW - 10 * MINUTE);
  assert.equal(d.horizonS, 600);
  assert.ok(d.featureAsOf <= d.decidedAt);
  assert.ok(Object.isFrozen(d.features));
});

test('solicitation is a penalty, not a gate: it stays in the log with its features', () => {
  const d = admit(
    input({ item: item({ text: 'like and follow, tag a friend' }), admissionBar: 0.19 }),
    DEFAULT_POLICY,
    ctx(ORDINARY_SEED),
  );

  assert.equal(d.features.engagementBait, 1);
  assert.equal(d.verdict, 'drop');
  assert.equal(d.reason, 'A4_score_below_bar');
});
