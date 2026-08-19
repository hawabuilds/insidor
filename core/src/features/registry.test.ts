/**
 * The index of feature sets, as the properties that make it worth having.
 *
 * A registry nobody checks is a comment. These four tests are the checks: that two
 * sets cannot share a name, that a wide set cannot be mistaken for a narrow one, and
 * that the shape hash is actually a hash of a shape rather than of a concatenation.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { STAGE_NAMES } from '@insidor/contracts/decision.ts';

import { ALL_FEATURE_SETS, FEATURE_SETS, WIDE_FEATURE_SETS, featureShapeHash } from './registry.ts';

test('no two feature sets share a name, so feature_set alone identifies a shape', () => {
  // ★ The single most expensive silent bug in a training pipeline is two rows carrying
  // the same `featureSet` string and different key sets. Nothing about them looks
  // wrong until the model is worse and nobody can say when it started. One name per
  // shape is the invariant that makes the `feature_set` column mean anything, and this
  // is the assertion that keeps it true when somebody copies a set id.
  assert.equal(new Set(ALL_FEATURE_SETS).size, ALL_FEATURE_SETS.length);
});

test('every stage has a narrow set and the wide sets are keyed by subject instead', () => {
  for (const stage of STAGE_NAMES) {
    assert.ok(FEATURE_SETS[stage], `${stage} has no feature set`);
  }

  // A wide set does not belong to a stage. The item vector is logged by ADMIT today
  // and by whatever ranks items tomorrow; keying it by stage would mean the same set
  // id copied under three names, and then two of the copies drifting.
  const narrow = new Set<string>(Object.values(FEATURE_SETS));
  for (const wide of Object.values(WIDE_FEATURE_SETS)) {
    assert.ok(!narrow.has(wide), `${wide} is registered as both a narrow and a wide set`);
  }
  assert.deepEqual(Object.keys(WIDE_FEATURE_SETS).sort(), ['candidate', 'item', 'story']);
});

test('every set id carries a version, because a set that changes shape must change name', () => {
  // The template type already forbids this at compile time. It is asserted at runtime
  // as well because these strings arrive back from storage, where the type is a
  // promise rather than a guarantee.
  for (const id of ALL_FEATURE_SETS) assert.match(id, /\.v\d+$/);
});

test('the shape hash is a hash of the shape: order-blind, and it cannot be tricked by a join', () => {
  assert.equal(featureShapeHash(['b', 'a']), featureShapeHash(['a', 'b']));

  // ★ Concatenating without a separator is the oldest hashing mistake there is:
  // ['ab','c'] and ['a','bc'] both spell "abc". A separator that cannot occur in a
  // feature name is what makes these two different shapes rather than one.
  assert.notEqual(featureShapeHash(['ab', 'c']), featureShapeHash(['a', 'bc']));

  // Adding a key changes the hash. That is the whole mechanism: a builder that
  // silently stops emitting a field fails a comparison instead of quietly producing
  // rows that are not comparable to the ones beside them.
  assert.notEqual(featureShapeHash(['a', 'b']), featureShapeHash(['a', 'b', 'c']));
});
