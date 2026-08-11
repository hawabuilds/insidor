/**
 * The tree walker, against a model small enough to compute by hand.
 *
 * These are not a substitute for the parity fixture — that one compares this
 * code to LightGBM's own predictions over 1,000 real rows and is the reason a
 * second language is allowed at all. These tests exist for the cases the parity
 * fixture will not reliably contain: the missing-value branches, the boundary,
 * and every refusal. A trained model may simply never produce a NaN in the
 * fixture rows, and the walker's NaN handling is exactly where a naive walker is
 * wrong by 0.92.
 *
 * Every expected number below is derived in a comment from the tree structure.
 * If one of them is ever "fixed" to match the code, the test has been deleted.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadModel, predict, rawScore, layout, UnsupportedModelError } from './lgbm.ts';

/**
 * Two trees, two features.
 *   tree 0 splits on `a` at 1.5, missing_type NaN,  default_left  true
 *   tree 1 splits on `b` at 0.0, missing_type Zero, default_left false
 * Leaf values are exact binary fractions, so every sum below is exact in float64
 * and can be asserted with `===` rather than a tolerance.
 */
const TOY = {
  name: 'tree',
  version: 'v4',
  num_class: 1,
  num_tree_per_iteration: 1,
  objective: 'binary sigmoid:1',
  feature_names: ['a', 'b'],
  tree_info: [
    {
      tree_index: 0,
      num_cat: 0,
      tree_structure: {
        split_index: 0,
        split_feature: 0,
        threshold: 1.5,
        decision_type: '<=',
        default_left: true,
        missing_type: 'NaN',
        left_child: { leaf_index: 0, leaf_value: 0.5 },
        right_child: { leaf_index: 1, leaf_value: -0.25 },
      },
    },
    {
      tree_index: 1,
      num_cat: 0,
      tree_structure: {
        split_index: 0,
        split_feature: 1,
        threshold: 0.0,
        decision_type: '<=',
        default_left: false,
        missing_type: 'Zero',
        left_child: { leaf_index: 0, leaf_value: 0.125 },
        right_child: { leaf_index: 1, leaf_value: -0.5 },
      },
    },
  ],
};

const raw = (a: number | null, b: number | null): number => {
  const model = loadModel(TOY);
  return rawScore(model, layout(model, { a, b }).values);
};

test('an ordinary row walks both trees and sums the leaves', () => {
  // a=1 ≤ 1.5 → 0.5 ; b=−1 ≤ 0 → 0.125
  assert.equal(raw(1, -1), 0.625);
  // a=2 > 1.5 → −0.25 ; b=5 > 0 → −0.5
  assert.equal(raw(2, 5), -0.75);
});

test('the threshold comparison is <=, not <', () => {
  // a=1.5 must take the LEFT branch. Off-by-one here is invisible in aggregate
  // and moves every row sitting exactly on a split.
  assert.equal(raw(1.5, 5), 0.5 - 0.5);
});

test('a null feature takes the missing branch, not the zero branch', () => {
  // tree 0 has missing_type NaN and default_left=true  → 0.5
  // tree 1 has missing_type Zero, b=0 is inside the zero band, default_left=false → −0.5
  assert.equal(raw(null, 0), 0);

  // ★ The case a naive walker gets wrong. With missing_type=Zero, LightGBM
  // coerces NaN to 0.0 FIRST, which then lands in the zero band and takes the
  // default branch — so a missing `b` and a `b` of exactly zero are the same
  // row. Comparing NaN <= 0 instead evaluates false and goes right by accident;
  // here it goes right by rule, and the two agree only because default_left is
  // false. Flip default_left and the naive walker is wrong.
  assert.equal(raw(null, null), 0);
});

test('with default_left=true and missing_type=Zero, a missing value goes LEFT', () => {
  // This is the configuration where a naive `NaN <= threshold` walker diverges.
  const flipped = structuredClone(TOY) as typeof TOY;
  flipped.tree_info[1]!.tree_structure.default_left = true;
  const model = loadModel(flipped);
  // tree 0: a=1 → 0.5 ; tree 1: b missing → Zero band → default LEFT → 0.125
  assert.equal(rawScore(model, layout(model, { a: 1, b: null }).values), 0.625);
});

test('a feature the model wants and the vector lacks is counted, not silently zero', () => {
  const model = loadModel(TOY);
  const { absent } = layout(model, { a: 1 });
  assert.equal(absent, 1);
  // and a null is NOT absent — we read it, it had no value
  assert.equal(layout(model, { a: 1, b: null }).absent, 0);
});

test('the logistic link uses the model’s own sigmoid', () => {
  const model = loadModel(TOY);
  const p = predict(model, { a: 1, b: -1 });
  // logit(p) must return the raw score exactly, for sigmoid = 1
  assert.ok(Math.abs(Math.log(p / (1 - p)) - 0.625) < 1e-12);

  const sharper = { ...TOY, objective: 'binary sigmoid:2' };
  const p2 = predict(loadModel(sharper), { a: 1, b: -1 });
  // logit(p2) / raw must equal the sigmoid. Serving a sigmoid-2 model as if it
  // were sigmoid-1 is wrong by ~0.15 in probability space and looks plausible.
  assert.ok(Math.abs(Math.log(p2 / (1 - p2)) / 0.625 - 2) < 1e-12);
});

test('missing_type None compares the coerced zero against the threshold', () => {
  const model = loadModel({
    num_class: 1,
    num_tree_per_iteration: 1,
    objective: 'regression',
    feature_names: ['a'],
    tree_info: [
      {
        num_cat: 0,
        tree_structure: {
          split_feature: 0,
          threshold: -1,
          decision_type: '<=',
          default_left: true,
          missing_type: 'None',
          left_child: { leaf_value: 1 },
          right_child: { leaf_value: 2 },
        },
      },
    ],
  });
  // NaN → 0, and 0 <= −1 is false, so the row goes RIGHT despite default_left.
  // default_left is not consulted at all under missing_type None.
  assert.equal(predict(model, { a: null }), 2);
  assert.equal(predict(model, { a: -5 }), 1);
});

/* ── the refusals. Every one of these is a silent-wrong-answer if allowed. ── */

const refuses = (patch: (m: Record<string, unknown>) => void, needle: string): void => {
  const m = structuredClone(TOY) as unknown as Record<string, unknown>;
  patch(m);
  assert.throws(
    () => loadModel(m),
    (e: unknown) => e instanceof UnsupportedModelError && e.message.includes(needle),
    `expected a refusal mentioning "${needle}"`,
  );
};

test('a categorical split is refused at load, not coerced at predict', () => {
  // LightGBM dumps a categorical threshold as the string "0||1||2||7".
  // `x <= "0||1||2||7"` coerces to NaN, evaluates false, and every row takes the
  // right branch forever — max error 0.98, no exception.
  refuses((m) => {
    const trees = m['tree_info'] as { tree_structure: Record<string, unknown> }[];
    trees[0]!.tree_structure['decision_type'] = '==';
    trees[0]!.tree_structure['threshold'] = '0||1||2||7';
  }, 'decision_type');

  refuses((m) => {
    (m['tree_info'] as Record<string, unknown>[])[0]!['num_cat'] = 3;
  }, 'categorical');
});

test('a linear-tree model is refused', () => {
  refuses((m) => {
    const trees = m['tree_info'] as { tree_structure: Record<string, unknown> }[];
    (trees[0]!.tree_structure['left_child'] as Record<string, unknown>)['leaf_coeff'] = [0.1];
  }, 'linear tree');
});

test('an unknown missing_type is refused rather than defaulted', () => {
  refuses((m) => {
    const trees = m['tree_info'] as { tree_structure: Record<string, unknown> }[];
    trees[0]!.tree_structure['missing_type'] = 'Whatever';
  }, 'missing_type');
});

test('multiclass, random-forest and unknown objectives are refused', () => {
  refuses((m) => {
    m['num_class'] = 3;
  }, 'num_class');
  refuses((m) => {
    m['average_output'] = true;
  }, 'average_output');
  refuses((m) => {
    m['objective'] = 'multiclass num_class:3';
  }, 'not implemented');
});

test('a binary objective with no sigmoid is refused rather than assumed to be 1', () => {
  refuses((m) => {
    m['objective'] = 'binary';
  }, 'sigmoid');
});
